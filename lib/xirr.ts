export interface CashFlow {
  date: Date
  amount: number
}

export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null

  // Need at least one positive and one negative cash flow
  const hasPos = flows.some(f => f.amount > 0)
  const hasNeg = flows.some(f => f.amount < 0)
  if (!hasPos || !hasNeg) return null

  const daysFromFirst = flows.map(f => (f.date.getTime() - flows[0].date.getTime()) / (365.25 * 86400000))

  function npv(rate: number): number {
    return flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, daysFromFirst[i]), 0)
  }

  function dnpv(rate: number): number {
    return flows.reduce((sum, f, i) => {
      const t = daysFromFirst[i]
      return sum - t * f.amount / Math.pow(1 + rate, t + 1)
    }, 0)
  }

  let rate = 0.1
  for (let iter = 0; iter < 100; iter++) {
    const val = npv(rate)
    const deriv = dnpv(rate)
    if (Math.abs(deriv) < 1e-12) break
    const next = rate - val / deriv
    if (Math.abs(next - rate) < 1e-8) return next
    rate = next
    // Guard against divergence
    if (rate < -0.999 || rate > 100) return null
  }
  return Math.abs(npv(rate)) < 1 ? rate : null
}
