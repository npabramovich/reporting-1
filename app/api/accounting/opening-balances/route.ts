import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { assertBalanced, roundCents } from '@/lib/accounting/ledger'
import { lpCapitalCode } from '@/lib/accounting/chart'
import type { Posting } from '@/lib/accounting/types'

// POST — book per-LP opening capital balances as a posted opening entry.
// Cutover pattern: credit each LP's capital account, debit a single offset
// (opening net assets) for the total. Capital accounts derive from the per-LP
// credits, so the offset account only has to make the entry balance.
//
// Body: { entryDate, offsetAccountCode?, balances: [{ lpEntityId, amount }] }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const entryDate: string = body?.entryDate
  const offsetCode: string = body?.offsetAccountCode ?? '1100' // Investments at cost
  const balances = (body?.balances ?? []) as { lpEntityId: string; amount: number }[]

  if (!entryDate || !Array.isArray(balances) || balances.length === 0) {
    return NextResponse.json({ error: 'entryDate and at least one balance are required' }, { status: 400 })
  }

  // Load the chart; the offset account must already exist (seed the chart first).
  const { data: chartRows, error: chartErr } = await admin
    .from('chart_of_accounts' as any)
    .select('id, code, lp_entity_id')
    .eq('fund_id', gate.fundId)
  if (chartErr) return dbError(chartErr, 'opening-balances-chart')

  const chart = (chartRows as any[]) ?? []
  const offset = chart.find(a => a.code === offsetCode)
  if (!offset) {
    return NextResponse.json({ error: `Offset account ${offsetCode} not found — seed the chart of accounts first` }, { status: 400 })
  }

  // Ensure a per-LP capital account exists for each entity, creating any missing.
  const byEntity = new Map<string, string>() // lpEntityId → account_id
  for (const a of chart) if (a.lp_entity_id) byEntity.set(a.lp_entity_id, a.id)

  const { data: entityRows } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name')
    .eq('fund_id', gate.fundId)
  const entityName = new Map<string, string>(((entityRows as any[]) ?? []).map(e => [e.id, e.entity_name]))

  const toCreate = balances
    .filter(b => !byEntity.has(b.lpEntityId))
    .map(b => ({
      fund_id: gate.fundId,
      code: lpCapitalCode(b.lpEntityId),
      name: `Partners' capital — ${entityName.get(b.lpEntityId) ?? b.lpEntityId}`,
      type: 'equity',
      subtype: 'lp_capital',
      lp_entity_id: b.lpEntityId,
    }))

  if (toCreate.length > 0) {
    const { data: created, error: createErr } = await admin
      .from('chart_of_accounts' as any)
      .insert(toCreate)
      .select('id, lp_entity_id')
    if (createErr) return dbError(createErr, 'opening-balances-accounts')
    for (const a of ((created as any[]) ?? [])) byEntity.set(a.lp_entity_id, a.id)
  }

  // Build the balanced opening entry.
  let total = 0
  const postings: Posting[] = []
  for (const b of balances) {
    const amount = roundCents(Number(b.amount))
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: `Invalid amount for ${b.lpEntityId}` }, { status: 400 })
    }
    total = roundCents(total + amount)
    postings.push({ accountId: byEntity.get(b.lpEntityId)!, amount: -amount, currency: 'USD', lpEntityId: b.lpEntityId })
  }
  postings.push({ accountId: offset.id, amount: total, currency: 'USD', lpEntityId: null })

  try {
    assertBalanced({ fundId: gate.fundId, entryDate, postings })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const { data: entry, error: entryErr } = await admin
    .from('journal_entries' as any)
    .insert({
      fund_id: gate.fundId,
      entry_date: entryDate,
      memo: 'Opening balances (cutover)',
      source_type: 'opening_balance',
      status: 'posted',
      created_by: user.id,
      posted_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (entryErr) return dbError(entryErr, 'opening-balances-entry')

  const entryId = (entry as any).id
  const { error: postErr } = await admin
    .from('journal_postings' as any)
    .insert(postings.map(p => ({
      fund_id: gate.fundId,
      journal_entry_id: entryId,
      account_id: p.accountId,
      amount: p.amount,
      currency: p.currency,
      lp_entity_id: p.lpEntityId ?? null,
    })))
  if (postErr) {
    await admin.from('journal_entries' as any).delete().eq('id', entryId).eq('fund_id', gate.fundId)
    return dbError(postErr, 'opening-balances-postings')
  }

  return NextResponse.json({ ok: true, entryId, lpCount: balances.length, total })
}
