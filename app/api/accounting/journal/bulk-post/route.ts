import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { dbError } from '@/lib/api-error'
import { closedPeriodRanges, dateInAnyClosedPeriod } from '@/lib/accounting/periods'

// One page per call — posting is a real ledger write, and a serverless request must finish
// well inside its timeout. The UI repeats while `remaining > 0`.
const BATCH = 500

// POST — post many DRAFT entries at once (the "Post all drafts" action).
//   body: { group?, start?, end?, ids?, afterId? }
//     ids     — post exactly these entries (still draft-only, still guarded), one shot; OR
//     start/end — restrict the "post all" window (omit both for all drafts);
//     afterId — keyset cursor from the previous call's `cursor`, to page through.
// Each entry is posted only if it is a draft, is balanced, and does not fall in a closed
// period; everything else is returned in `skipped` with a reason. Returns { posted, skipped,
// hasMore, cursor } — the client loops with afterId=cursor while hasMore is true.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const ids: string[] | null = Array.isArray(body?.ids) && body.ids.length > 0 ? body.ids : null
  const start: string | null = body?.start || null
  const end: string | null = body?.end || null
  // Keyset cursor: the last entry id the previous call processed. Posted drafts leave the
  // draft set; skipped ones (closed period / out of balance) stay draft but sort BEFORE the
  // cursor, so paging by `id > afterId` advances past them — the loop can't re-examine or
  // double-count a stuck entry, and can't be starved by a wall of them.
  const afterId: string | null = typeof body?.afterId === 'string' ? body.afterId : null

  // Candidate drafts — scoped to the vehicle, ordered by id for a stable keyset, with
  // postings for the balance check.
  let query = admin
    .from('journal_entries' as any)
    .select('id, entry_date, journal_postings(amount)')
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'draft')
    .order('id', { ascending: true })
    .limit(BATCH + 1)
  if (ids) {
    query = query.in('id', ids)
  } else {
    if (start) query = query.gte('entry_date', start)
    if (end) query = query.lte('entry_date', end)
    if (afterId) query = query.gt('id', afterId)
  }

  const { data: drafts, error } = await query
  if (error) return dbError(error, 'journal-bulk-post')

  const rows = (drafts as any[]) ?? []
  const hasMore = rows.length > BATCH
  const batch = rows.slice(0, BATCH)

  const closed = await closedPeriodRanges(admin, gate.fundId, group)

  const toPost: string[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const e of batch) {
    if (dateInAnyClosedPeriod(closed, e.entry_date)) {
      skipped.push({ id: e.id, reason: `In a closed period (${e.entry_date}) — reopen it first.` })
      continue
    }
    const sum = ((e.journal_postings as any[]) ?? []).reduce((s, p) => s + Number(p.amount), 0)
    if (Math.abs(sum) > 0.005) {
      skipped.push({ id: e.id, reason: `Out of balance by ${sum.toFixed(2)} — fix it before posting.` })
      continue
    }
    toPost.push(e.id)
  }

  if (toPost.length > 0) {
    const { error: upErr } = await admin
      .from('journal_entries' as any)
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .in('id', toPost)
      .eq('fund_id', gate.fundId)
      .eq('status', 'draft') // defence-in-depth: no-op any row a concurrent write already moved
    if (upErr) return dbError(upErr, 'journal-bulk-post-update')
    // Keep any bank transactions that point at these entries in step.
    await admin.from('bank_transactions' as any)
      .update({ status: 'reconciled' })
      .in('journal_entry_id', toPost)
      .eq('fund_id', gate.fundId)
  }

  const cursor = batch.length ? batch[batch.length - 1].id : null
  return NextResponse.json({ posted: toPost.length, skipped, hasMore, cursor })
}
