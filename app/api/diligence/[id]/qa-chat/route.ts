import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { withTopicalGuardrail } from '@/lib/ai/topical-guard'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { extractJsonObject } from '@/lib/memo-agent/parse-ai-json'
import { buildQAChatContext } from '@/lib/diligence/qa-chat-context'
import { getAffinityKey } from '@/lib/affinity/credentials'
import { AFFINITY_TOOLS, makeAffinityExecutor, affinityMcpServer } from '@/lib/affinity/tools'
import type { AIResult } from '@/lib/ai/types'

// The POST handler makes a synchronous, user-facing LLM call plus several DB
// round-trips. Netlify functions default to a 10s timeout, which the model
// call alone can exceed — the function is then killed before returning a
// Response and the browser surfaces a bare "Failed to fetch". Extend it to
// match the other LLM-bound routes in this repo (companies/documents = 60).
export const maxDuration = 60

interface ChatRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Array<{ document_id: string; summary: string }>
  author_id: string | null
  model: string | null
  created_at: string
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await (admin as any)
    .from('diligence_qa_chats')
    .select('id, role, content, citations, author_id, model, created_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: (data ?? []) as ChatRow[] })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const body = await req.json().catch(() => ({}))
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })

  const { data: deal } = await (admin as any)
    .from('diligence_deals')
    .select('id, name, affinity_organization_id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Persist user message first so the UI sees consistent state even if the
  // assistant call later fails.
  const { data: userMsg, error: userErr } = await (admin as any)
    .from('diligence_qa_chats')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      role: 'user',
      content: question,
      author_id: userId,
    })
    .select('id, role, content, citations, author_id, model, created_at')
    .single()
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 })

  // Load conversation history (excluding the just-inserted user message —
  // we'll add it as the final turn explicitly below).
  const { data: history } = await (admin as any)
    .from('diligence_qa_chats')
    .select('role, content, created_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: true })
    .limit(40)
  const prior = ((history ?? []) as Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>)
    .filter(m => m.content !== question || m.role !== 'user')
    .slice(-12)  // keep prompt size in check, last ~6 user/assistant pairs

  // Build the evidence context.
  const ctx = await buildQAChatContext({ admin, fundId, dealId: params.id })

  // Use the Q&A stage's provider for cost-tracking consistency.
  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'qa')

  // Affinity is attached only when THIS user has connected their own Affinity
  // key. The key carries their permissions, so the assistant can never surface
  // CRM records the asking partner couldn't open themselves.
  const affinityKey = await getAffinityKey(admin, userId)
  const { data: fundSettings } = await (admin as any)
    .from('fund_settings')
    .select('affinity_mcp_enabled')
    .eq('fund_id', fundId)
    .maybeSingle()
  const useMcp = !!(fundSettings as any)?.affinity_mcp_enabled

  const linkedOrgId = (deal as any).affinity_organization_id as number | null
  // Tool use is Anthropic-only in this codebase. On any other provider we fall
  // back to the plain evidence-only answer rather than silently pretending the
  // assistant has CRM access it doesn't have.
  const affinityAvailable = !!affinityKey && provider.supportsToolLoop === true

  const affinityBlock = affinityAvailable
    ? `

AFFINITY CRM ACCESS
You can query the fund's Affinity CRM with the affinity_* tools to answer questions about the
RELATIONSHIP history — past meetings, call notes, who introduced us, what was discussed and when.
${linkedOrgId
    ? `This deal is already linked to Affinity organization_id ${linkedOrgId}. Use that id directly; you do not need to search for it.`
    : `This deal is not linked to an Affinity company yet, so use affinity_search_companies first to find it by name.`}

When to reach for Affinity:
- The question is about history, relationships, or what was said in a meeting — the data room holds
  documents, but the CRM holds the conversation record.
- The data-room evidence below does not answer the question and the CRM plausibly might.

Do NOT use Affinity for questions the data room already answers — it costs a round-trip and the
documents are the primary evidence. Content you take from Affinity should be attributed in your
answer as coming from an Affinity note (with its date), not cited as a data-room document.`
    : ''

  const systemPrompt = `You answer partner questions about an active diligence deal using the evidence below${affinityAvailable ? ', plus the fund\'s Affinity CRM when the question is about relationship history' : ''}. If the evidence does not contain the answer, say so plainly and suggest where the partner could look (a missing document, a research gap, a question to ask the founders).

Rules:
- Be concise and direct. No throat-clearing.
- Never fabricate numbers, names, or sources.
- When you cite a document, reference it by its file name as listed in DATA-ROOM EVIDENCE.
- If multiple sources agree, say so. If they contradict, surface the contradiction.
- Stage-aware: ${ctx.stage ? `this is a ${ctx.stage} company, calibrate expectations accordingly` : 'no stage on record, ask the partner if it matters'}.${affinityBlock}

Output format: return JSON ONLY of the form:
{
  "answer": "<your answer in plain text, 1–5 short paragraphs>",
  "citations": [{ "document_id": "<doc_id from the evidence>", "summary": "<one-line note about what you took from this doc>" }]
}

Cite up to 5 documents. Only cite document_ids that actually appear in DATA-ROOM EVIDENCE.

=== EVIDENCE ===
${ctx.text}`

  const userTurn = prior.length > 0
    ? prior.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n') + `\n\nUSER: ${question}`
    : question

  let answerText = ''
  let citations: Array<{ document_id: string; summary: string }> = []
  let affinityLookups: string[] = []
  try {
    let result: AIResult

    if (affinityAvailable && provider.createToolLoop) {
      const loop = await provider.createToolLoop({
        model,
        maxTokens: 1500,
        system: withTopicalGuardrail(systemPrompt),
        content: userTurn,
        // Either our read-only tools, or Affinity's hosted MCP server if the
        // fund opted into it (which also grants the model write access — see
        // lib/affinity/tools.ts).
        ...(useMcp
          ? { mcpServers: [affinityMcpServer(affinityKey!)] }
          : { tools: AFFINITY_TOOLS, executeTool: makeAffinityExecutor(affinityKey!) }),
        maxIterations: 5,
      })
      result = loop
      // Surfaced to the UI so the partner can see the assistant actually looked
      // something up, rather than wondering where a claim came from.
      affinityLookups = loop.toolCalls.filter(c => !c.isError).map(c => c.name)
    } else {
      result = await provider.createMessage({
        model,
        maxTokens: 1500,
        system: withTopicalGuardrail(systemPrompt),
        content: userTurn,
      })
    }

    const { text, usage } = result
    logAIUsage(admin, {
      fundId,
      provider: providerType,
      model,
      feature: 'diligence_qa_chat',
      usage,
    })
    const parsed = extractJsonObject(text)
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { answer?: unknown; citations?: unknown }
      answerText = typeof obj.answer === 'string' ? obj.answer : text
      if (Array.isArray(obj.citations)) {
        const validIds = new Set(ctx.citableDocs.map(d => d.id))
        citations = (obj.citations as any[])
          .filter(c => c && typeof c === 'object' && typeof c.document_id === 'string' && validIds.has(c.document_id))
          .slice(0, 5)
          .map(c => ({ document_id: c.document_id, summary: typeof c.summary === 'string' ? c.summary : '' }))
      }
    } else {
      // Model returned non-JSON — fall back to raw text rather than failing the turn.
      answerText = text
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      error: `Chat call failed: ${msg}`,
      user_message: userMsg,
    }, { status: 500 })
  }

  const { data: assistantMsg, error: assistantErr } = await (admin as any)
    .from('diligence_qa_chats')
    .insert({
      fund_id: fundId,
      deal_id: params.id,
      role: 'assistant',
      content: answerText,
      citations,
      model,
    })
    .select('id, role, content, citations, author_id, model, created_at')
    .single()
  if (assistantErr) return NextResponse.json({ error: assistantErr.message }, { status: 500 })

  // Auto-promote the exchange into the deal's evidence base. The memo draft,
  // checklist assessment, and future Q&A chat all read qa_answers on the
  // latest draft — so writing here makes the conversation visible to every
  // downstream agent stage without partner action.
  //
  // Best-effort: if there's no in-flight draft yet, skip (chat still works,
  // the exchange just doesn't enrich evidence until ingest has run). Errors
  // are swallowed so a write hiccup doesn't fail the chat response.
  try {
    const { data: draft } = await (admin as any)
      .from('diligence_memo_drafts')
      .select('id, qa_answers')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .eq('is_draft', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (draft) {
      const existing = Array.isArray((draft as any).qa_answers) ? (draft as any).qa_answers as any[] : []
      // Stable id linked to the assistant chat message so the same exchange
      // doesn't duplicate if this code path runs twice.
      const linkedId = `chat_${(assistantMsg as any).id.slice(0, 12)}`
      if (!existing.some(e => e && e.question_id === linkedId)) {
        existing.push({
          question_id: linkedId,
          question_text: question,
          answer_text: answerText,
          partner_id: userId,
          answered_at: (assistantMsg as any).created_at,
          feeds_dimensions: [],
          category: 'chat_qa',
          citations,
        })
        await (admin as any)
          .from('diligence_memo_drafts')
          .update({ qa_answers: existing })
          .eq('id', (draft as any).id)
      }
    }
  } catch {
    // ignore — evidence-base feed is best-effort
  }

  return NextResponse.json({
    user_message: userMsg,
    assistant_message: assistantMsg,
    // e.g. ['affinity_get_notes'] — lets the UI show "checked Affinity".
    affinity_lookups: affinityLookups,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // Bulk delete — partner-initiated "clear conversation".
  const { error } = await (admin as any)
    .from('diligence_qa_chats')
    .delete()
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function ensureMember() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
