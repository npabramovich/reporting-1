import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAudit } from '@/lib/audit/events'
import type { TaxRunResult } from './book-tax-run'

/**
 * The audit record for a posted book-to-tax run, shared by the Tax page's route and the agent's
 * post_tax_adjustments so both leave the same trail. A run that wrote and voided nothing records
 * nothing.
 */
export async function auditTaxRun(
  admin: SupabaseClient,
  who: { fundId: string; userId: string },
  group: string,
  taxYear: number,
  result: TaxRunResult,
): Promise<void> {
  const passThrough = result.passThrough
  if (result.entryIds.length === 0 && result.voided === 0 && (passThrough?.entryIds.length ?? 0) === 0 && (passThrough?.voided ?? 0) === 0) return
  await recordAudit(admin, {
    fundId: who.fundId, actorId: who.userId, action: 'tax.adjustments', subjectType: 'tax_year', subjectId: `${group}:${taxYear}`,
    details: {
      group, taxYear, proposals: result.proposals.map(p => ({ kind: p.kind, amount: p.amount })), entries: result.entryIds.length, voidedPrior: result.voided,
      // The lower-tier K-1s posted in the same run: which holdings, and the basis each moved.
      ...(passThrough ? {
        k1PassThrough: passThrough.holdings.filter(h => !h.skipped).map(h => ({ companyId: h.companyId, basisChange: h.basisChange })),
        k1Entries: passThrough.entryIds.length, k1VoidedPrior: passThrough.voided,
      } : {}),
    },
  })
}

/** What to tell a person when a run is blocked on accounts the vehicle's chart lacks. */
export function missingAccountsMessage(missing: string[]): string {
  return `This vehicle's chart is missing ${missing.join(', ')}. ` +
    "Add them under the entity's Admin → Chart of accounts, then post again."
}
