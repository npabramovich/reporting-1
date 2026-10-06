/** Classify only an unambiguous cash/capital exchange; other imports keep their provenance. */
export function cashCapitalSource(
  postings: { accountId: string; amount: number }[],
  accounts: { id: string; subtype?: string | null }[],
): 'contribution' | 'distribution' | null {
  const byId = new Map(accounts.map(account => [account.id, account]))
  const cash = postings.filter(posting => byId.get(posting.accountId)?.subtype === 'cash')
  const capital = postings.filter(posting => byId.get(posting.accountId)?.subtype === 'lp_capital')
  if (!cash.length || !capital.length || cash.length + capital.length !== postings.length) return null
  if (cash.every(p => p.amount > 0) && capital.every(p => p.amount < 0)) return 'contribution'
  if (cash.every(p => p.amount < 0) && capital.every(p => p.amount > 0)) return 'distribution'
  return null
}
