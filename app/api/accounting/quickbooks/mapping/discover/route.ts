import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { ensureInvestmentAccounts, investmentCostCode } from '@/lib/accounting/investments'

/**
 * Create user-classified holdings and their dedicated ledger accounts, or reuse existing
 * portfolio identities without changing their type. Returns cost codes for the mapping UI.
 *
 * A fund of funds keeps a QuickBooks sub-account per underlying fund
 * ("Investments:Acme Ventures III"), so the mapping screen is where the twenty-odd holdings
 * get created. Re-runnable: a name that already exists is reported as existing, never
 * duplicated — discovery runs again on every re-import pass.
 *
 * POST — { group?, holdings: string[], holdingTypes: Record<string, 'fund' | 'company'> }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const types: Record<string, string> = body?.holdingTypes ?? {}
  const names: string[] = Array.isArray(body?.holdings)
    ? body.holdings.filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n: string) => n.trim())
    : []
  if (names.length === 0) return NextResponse.json({ error: 'holdings[] is required' }, { status: 400 })
  if (names.some(name => !['fund', 'company'].includes(types[name]))) {
    return NextResponse.json({ error: 'Choose fund or company for each holding before creating it.' }, { status: 400 })
  }

  const group = await resolveGroupOr400(admin, gate, body?.group ?? null)
  if (group instanceof NextResponse) return group

  // Match case-insensitively against EVERY holding, not just fund ones: if the name already
  // exists as a company, creating a second row with the same name would split its history.
  const { data: existingRows, error: readError } = await admin
    .from('companies').select('id, name, holding_type, portfolio_group').eq('fund_id', gate.fundId)
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  const byName = new Map(
    ((existingRows as any[]) ?? []).map(r => [String(r.name).trim().toLowerCase(), r]),
  )

  const created: { id: string; name: string }[] = []
  const existing: { name: string; holdingType: string }[] = []
  const errors: string[] = []
  const linked: { id: string; name: string; sourceName: string }[] = []

  for (const name of new Set(names)) {
    const hit = byName.get(name.toLowerCase())
    if (hit) {
      if (!(hit.portfolio_group ?? []).includes(group)) {
        const { error } = await admin.from('companies')
          .update({ portfolio_group: [...(hit.portfolio_group ?? []), group] })
          .eq('fund_id', gate.fundId).eq('id', hit.id)
        if (error) { errors.push(`${name}: ${error.message}`); continue }
      }
      existing.push({ name: hit.name, holdingType: hit.holding_type })
      linked.push({ id: hit.id, name: hit.name, sourceName: name })
      continue
    }

    const { data: holding, error } = await admin
      .from('companies')
      .insert({
        fund_id: gate.fundId, name, holding_type: types[name] as 'fund' | 'company', status: 'active',
        portfolio_group: [group],
      })
      .select('id, name').single()
    if (error || !holding) { errors.push(`${name}: ${error?.message ?? 'insert failed'}`); continue }

    if (types[name] === 'fund') {
      const { error: termErr } = await (admin as any).from('fund_holding_terms').insert({
        fund_id: gate.fundId, company_id: holding.id, commitment: 0,
      })
      if (termErr) errors.push(`${name}: terms — ${termErr.message}`)
    }

    created.push({ id: holding.id, name: holding.name })
    byName.set(name.toLowerCase(), { ...holding, holding_type: types[name] })
    linked.push({ id: holding.id, name: holding.name, sourceName: name })
  }

  // Include existing holdings: earlier runs may have created the record but failed to create
  // accounts, or the holding may already be used by a different vehicle.
  let mappings: { name: string; code: string }[] = []
  if (linked.length > 0) {
    try {
      const accounts = await ensureInvestmentAccounts(admin, gate.fundId, group, linked)
      mappings = linked.filter(h => accounts.has(h.id)).map(h => ({ name: h.sourceName, code: investmentCostCode(h.id) }))
    } catch (e) {
      errors.push(`Could not create investment accounts: ${(e as Error).message}`)
    }
  }

  return NextResponse.json({ created, existing, errors, mappings })
}
