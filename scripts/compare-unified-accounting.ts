/** Read-only rollout comparison. Usage:
 * npx tsx --env-file=.env.local scripts/compare-unified-accounting.ts FUND_UUID YYYY-MM-DD
 * Prints amounts and provenance only; never imports, posts, or modifies records.
 */
import { createAdminClient } from '../lib/supabase/admin'
import { loadFundPreload, vehicleCapitalPreload } from '../lib/accounting/fund-preload'
import { loadPostedLedger } from '../lib/accounting/load'
import { loadCapitalPostings } from '../lib/accounting/capital-source'
import { positionsToPostings } from '../lib/accounting/lp-positions'
import { computeCapitalAccounts } from '../lib/accounting/capital-account'

async function main() {
  const [fundId, asOf] = process.argv.slice(2)
  if (!/^[0-9a-f-]{36}$/i.test(fundId ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('Provide a fund UUID and an explicit YYYY-MM-DD reporting date.')
  const admin = createAdminClient()
  const pre = await loadFundPreload(admin, fundId, asOf)
  const compared = new Set<string>()
  const output = []
  for (const [group, vehicleId] of pre.idMap) {
    if (compared.has(vehicleId)) continue
    compared.add(vehicleId)
    const inputs = vehicleCapitalPreload(pre, group)
    const ledger = await loadPostedLedger(admin, fundId, group, asOf, pre.idMap, inputs.ledgerRows)
    const bookValues = computeCapitalAccounts(ledger.capitalPostings)
    const reportedValues = computeCapitalAccounts(positionsToPostings(inputs.positions ?? []))
    const current = await loadCapitalPostings(admin, fundId, group, asOf, pre.idMap, inputs)
    for (const [lpId, evidence] of current.evidenceByLp) {
      const old = reportedValues.get(lpId)
      const booked = bookValues.get(lpId)
      const before = { contributions: old?.contributions ?? 0, distributions: -(old?.distributions ?? 0), nav: old?.ending ?? 0 }
      output.push({ vehicleId, lpId, asOf, bookValues: booked ? { contributions: booked.contributions, distributions: -booked.distributions, nav: booked.ending } : null, basis: evidence.basis, observationDate: evidence.asOf,
        reportedValues: old ? before : null, after: evidence.values, changed: Object.keys(before).some(k => before[k as keyof typeof before] !== evidence.values[k as keyof typeof before]),
        reason: evidence.missing.length ? 'Missing reported inputs are preserved as unknown' : evidence.conflict ? 'Reported balance retained while accounting records conflict' : evidence.basis === 'reported' ? 'Dated statement retained until books reconcile through the reporting date' : 'Accounting evidence',
      })
    }
  }
  process.stdout.write(JSON.stringify({ definition: 'capital-v1', fundId, asOf, comparisons: output }, null, 2) + '\n')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
