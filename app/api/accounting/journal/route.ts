import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { dbError } from '@/lib/api-error'
import { persistEntry } from '@/lib/accounting/persist'
import type { JournalEntry, Posting } from '@/lib/accounting/types'

// GET — list the vehicle's journal entries with their postings.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { data, error } = await admin
    .from('journal_entries' as any)
    .select('*, journal_postings(*)')
    .eq('fund_id', gate.fundId)
    .eq('portfolio_group', group)
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
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { entryDate, memo, sourceType, sourceRef, status, postings } = body
  if (!entryDate || !Array.isArray(postings) || postings.length === 0) {
    return NextResponse.json({ error: 'entryDate and at least one posting are required' }, { status: 400 })
  }
  const normalized: Posting[] = postings.map((p: any) => ({ accountId: p.accountId, amount: Number(p.amount), currency: p.currency ?? 'USD', lpEntityId: p.lpEntityId ?? null }))
  if (normalized.some(p => !p.accountId || !Number.isFinite(p.amount))) {
    return NextResponse.json({ error: 'Each posting needs an accountId and a numeric amount' }, { status: 400 })
  }

  const entry: JournalEntry = { fundId: gate.fundId, entryDate, memo: memo ?? null, sourceType: sourceType ?? 'manual', sourceRef: sourceRef ?? null, postings: normalized }
  const result = await persistEntry(admin, gate.fundId, group, user.id, entry, status === 'posted' ? 'posted' : 'draft')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  const { data: full } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('id', result.entryId).single()
  return NextResponse.json(full ?? { id: result.entryId })
}
