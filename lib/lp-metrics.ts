// One definition of the LP performance ratios, so every surface — the live report, fund
// economics, the report-card PDF, the agent tools, and the LPs pages — computes them identically.
// Before this, ~10 copies existed and had started to drift (denominator and rounding differences).
//
// PAID-IN ≡ CALLED CAPITAL. "Paid-in capital" is just another term for called capital — they are
// the same thing. Capital is recognised when it is CALLED, whether or not it has actually been
// funded yet, so paid-in spans BOTH called-funded AND called-unfunded (the unfunded part is the
// receivable). It is the denominator for DPI, RVPI and TVPI everywhere, matching the LP snapshot.
// Do NOT substitute "funded" (called − receivable) for it.
//
// CAVEAT (stated honestly): this identity is not necessarily applied correctly everywhere in the
// data structures and calcs yet — some paths may still conflate paid-in with funded. Treat this
// note as the intended definition; when you touch a metric path, make it conform to this.

export interface LpFigures {
  commitment: number
  /** Paid-in = called capital (recognised, funded or not). */
  paidIn: number
  distributions: number
  nav: number
}

export interface LpRatios {
  /** Paid-in / commitment. */
  pctFunded: number | null
  /** Distributions / paid-in. */
  dpi: number | null
  /** NAV / paid-in. */
  rvpi: number | null
  /** (Distributions + NAV) / paid-in  ≡  DPI + RVPI. */
  tvpi: number | null
}

/** n / d, or null when d is not positive (avoids 0- and negative-denominator nonsense). */
export const lpRatio = (n: number, d: number): number | null => (d > 0 ? n / d : null)

/** The four LP ratios from a set of figures. Returns raw (unrounded) values; callers format. */
export function lpRatios(f: LpFigures): LpRatios {
  return {
    pctFunded: lpRatio(f.paidIn, f.commitment),
    dpi: lpRatio(f.distributions, f.paidIn),
    rvpi: lpRatio(f.nav, f.paidIn),
    tvpi: lpRatio(f.distributions + f.nav, f.paidIn),
  }
}
