import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { assertBalanced } from '@/lib/accounting/ledger'
import type { JournalEntry, Posting } from '@/lib/accounting/types'

// GET — list journal entries (most recent first) with their postings.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { data, error } = await admin
    .from('journal_entries' as any)
    .select('*, journal_postings(*)')
    .eq('fund_id', gate.fundId)
    .order('entry_date', { ascending: false })
    .limit(500)

  if (error) return dbError(error, 'accounting-journal')
  return NextResponse.json(data ?? [])
}

// POST — create a balanced journal entry with its postings.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json()
  const { entryDate, memo, sourceType, sourceRef, status, postings } = body

  if (!entryDate || !Array.isArray(postings) || postings.length === 0) {
    return NextResponse.json({ error: 'entryDate and at least one posting are required' }, { status: 400 })
  }

  const normalized: Posting[] = postings.map((p: any) => ({
    accountId: p.accountId,
    amount: Number(p.amount),
    currency: p.currency ?? 'USD',
    lpEntityId: p.lpEntityId ?? null,
  }))

  if (normalized.some(p => !p.accountId || !Number.isFinite(p.amount))) {
    return NextResponse.json({ error: 'Each posting needs an accountId and a numeric amount' }, { status: 400 })
  }

  const entry: JournalEntry = { fundId: gate.fundId, entryDate, postings: normalized }
  try {
    assertBalanced(entry)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const entryStatus = status === 'posted' ? 'posted' : 'draft'
  const { data: created, error: entryErr } = await admin
    .from('journal_entries' as any)
    .insert({
      fund_id: gate.fundId,
      entry_date: entryDate,
      memo: memo ?? null,
      source_type: sourceType ?? 'manual',
      source_ref: sourceRef ?? null,
      status: entryStatus,
      created_by: user.id,
      posted_at: entryStatus === 'posted' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (entryErr) return dbError(entryErr, 'accounting-journal-create')

  const entryId = (created as any).id
  const postingRows = normalized.map(p => ({
    fund_id: gate.fundId,
    journal_entry_id: entryId,
    account_id: p.accountId,
    amount: p.amount,
    currency: p.currency,
    lp_entity_id: p.lpEntityId ?? null,
  }))

  const { data: savedPostings, error: postErr } = await admin
    .from('journal_postings' as any)
    .insert(postingRows)
    .select('*')

  if (postErr) {
    // Roll back the header so we never leave an entry without its postings.
    await admin.from('journal_entries' as any).delete().eq('id', entryId).eq('fund_id', gate.fundId)
    return dbError(postErr, 'accounting-journal-postings')
  }

  return NextResponse.json({ ...(created as any), journal_postings: savedPostings ?? [] })
}
