import type { SupabaseClient } from '@supabase/supabase-js'
import { getFeatureProvider } from '@/lib/ai/feature-provider'
import { extractAttachmentText, type PostmarkPayload } from '@/lib/parsing/extractAttachmentText'
import { processDeal } from '@/lib/pipeline/processDeal'
import type { PostmarkPayload as PipelinePayload } from '@/lib/pipeline/processEmail'
import type { HeartbeatThread } from '@/lib/heartbeat/client'

/**
 * Turn a Heartbeat thread into an inbound deal.
 *
 * Shared by both delivery paths — the THREAD_CREATE webhook (fast) and the hourly
 * backfill poll (the safety net for threads posted while we were down). They are
 * deliberately redundant, so this function has to be safe to call twice for the
 * same thread. `heartbeat_threads (fund_id, thread_id)` is unique and we insert
 * there FIRST: the second caller's insert fails, it returns `duplicate`, and the
 * analyzer never runs twice.
 *
 * The thread is composed into a synthetic Postmark payload and run through the
 * same processDeal pipeline as an emailed pitch — identical to how the manual
 * form and the public submit form work. The deal lands in /deals with
 * intro_source = 'heartbeat'.
 */

export type IngestOutcome =
  | { result: 'imported'; dealId: string | null; emailId: string }
  | { result: 'duplicate' }
  | { result: 'skipped'; reason: string }
  | { result: 'failed'; error: string }

/** Below this, a thread is a "+1" or a link drop, not a pitch worth an AI call. */
const MIN_PITCH_CHARS = 40

export async function ingestHeartbeatThread(params: {
  admin: SupabaseClient
  fundId: string
  thread: HeartbeatThread
  channelName?: string | null
}): Promise<IngestOutcome> {
  const { admin, fundId, thread, channelName } = params

  const body = thread.text.trim()
  const title = thread.title?.trim() ?? ''

  // Claim the thread BEFORE doing any work. The unique constraint is what makes
  // webhook-and-poll redundancy safe; checking-then-inserting would race.
  const { data: claim, error: claimErr } = await (admin as any)
    .from('heartbeat_threads')
    .insert({
      fund_id: fundId,
      thread_id: thread.id,
      channel_id: thread.channelId ?? '',
      status: 'pending',
      thread_created_at: thread.createdAt,
    })
    .select('id')
    .single()

  if (claimErr) {
    // 23505 = unique_violation: another path already took this thread.
    if ((claimErr as any).code === '23505') return { result: 'duplicate' }
    return { result: 'failed', error: claimErr.message }
  }
  const claimId = (claim as { id: string }).id

  // Too thin to be a pitch. Recorded as seen (so we don't reconsider it every
  // poll) but never sent to the analyzer — an AI call per "welcome!" reply would
  // be pure cost and would litter /deals with junk.
  if (body.length + title.length < MIN_PITCH_CHARS) {
    await (admin as any)
      .from('heartbeat_threads')
      .update({ status: 'failed', error: 'Thread too short to be a pitch' })
      .eq('id', claimId)
    return { result: 'skipped', reason: 'too short' }
  }

  const authorEmail = thread.author.email
  const authorName = thread.author.name

  const subject = title || `Heartbeat thread from ${authorName ?? 'the community'}`
  const composedBody = [
    channelName ? `Posted in the ${channelName} channel of our Heartbeat community.` : 'Posted in our Heartbeat community.',
    authorName || authorEmail
      ? `Posted by: ${authorName ?? ''}${authorEmail ? ` <${authorEmail}>` : ''}`.trim()
      : null,
    '',
    title && body ? `${title}\n\n${body}` : (body || title),
  ].filter(v => v !== null).join('\n')

  // Two different senders, on purpose:
  //
  //   payload.From — EMPTY when the thread's author has no email on their
  //   Heartbeat profile. processDeal falls back to the sender's address to derive
  //   company_domain, so a placeholder like `noreply@heartbeat.local` would make
  //   EVERY such deal claim the domain `heartbeat.local` — and findPriorDeal
  //   would then chain each new one to the last as a duplicate of it. Empty means
  //   "no sender", so the analyzer's own extraction (or nothing) decides.
  //
  //   inbound_emails.from_address — NOT NULL in the schema, so it always needs a
  //   value. It's a provenance label for /audit, not an address, and nothing
  //   derives a domain from it.
  const payload: PostmarkPayload & {
    From: string; To: string; FromFull: { Email: string; Name: string }
    Subject: string; MessageID: string
  } = {
    From: authorEmail ?? '',
    To: 'heartbeat@hemrock.local',
    FromFull: { Email: authorEmail ?? '', Name: authorName ?? '' },
    Subject: subject,
    TextBody: composedBody,
    HtmlBody: '',
    MessageID: `<heartbeat-${thread.id}@hemrock.local>`,
    Attachments: [],
  }

  const { data: emailInsert, error: emailErr } = await admin
    .from('inbound_emails')
    .insert({
      fund_id: fundId,
      from_address: authorEmail ?? 'heartbeat',
      subject,
      received_at: thread.createdAt ?? new Date().toISOString(),
      raw_payload: payload as any,
      processing_status: 'processing',
      attachments_count: 0,
      routing_label: 'deals',
      routing_confidence: 1.0,
      routing_reasoning: `Heartbeat thread ${thread.id}${channelName ? ` in #${channelName}` : ''}`,
      routing_secondary_label: null,
      routed_to: 'deals',
    } as any)
    .select('id')
    .single()

  if (emailErr || !emailInsert) {
    await (admin as any)
      .from('heartbeat_threads')
      .update({ status: 'failed', error: emailErr?.message ?? 'inbound_emails insert failed' })
      .eq('id', claimId)
    return { result: 'failed', error: emailErr?.message ?? 'inbound_emails insert failed' }
  }
  const emailId = (emailInsert as { id: string }).id

  try {
    const { provider, model, providerType } = await getFeatureProvider(admin as any, fundId, 'deal_analysis')
    const extracted = await extractAttachmentText(payload)

    const result = await processDeal({
      supabase: admin as any,
      emailId,
      fundId,
      payload: payload as PipelinePayload,
      extracted,
      provider,
      providerType,
      model,
      // The channel is a fact, not something for the model to infer.
      introSourceOverride: 'heartbeat',
    })

    const dealId = result?.dealId ?? null

    await admin.from('inbound_emails').update({ processing_status: 'success' }).eq('id', emailId)
    await (admin as any)
      .from('heartbeat_threads')
      .update({ status: 'imported', deal_id: dealId, email_id: emailId, error: null })
      .eq('id', claimId)

    return { result: 'imported', dealId, emailId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[heartbeat/ingest] processDeal failed:', msg)
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: msg })
      .eq('id', emailId)
    await (admin as any)
      .from('heartbeat_threads')
      .update({ status: 'failed', email_id: emailId, error: msg.slice(0, 500) })
      .eq('id', claimId)
    return { result: 'failed', error: msg }
  }
}
