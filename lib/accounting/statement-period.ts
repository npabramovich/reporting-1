// Statement periods for the capital-account roll-forward.
//
// Deliberately NOT tied to `fiscal_periods`: those rows only exist for periods
// someone explicitly CLOSED, so relying on them would mean "this quarter" doesn't
// exist as an option until after you've locked it. These are pure date math and
// always available; a closed fiscal period can be offered alongside them.

export type PeriodPreset = 'this_quarter' | 'last_quarter' | 'ytd' | 'prior_year' | 'itd' | 'custom'

export interface StatementPeriod {
  preset: PeriodPreset
  /** Inclusive; null means "since inception". */
  start: string | null
  /** Inclusive. */
  end: string | null
  label: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const q = (month: number) => Math.floor(month / 3) // 0-3

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'prior_year', label: 'Prior year' },
  { value: 'itd', label: 'Inception to date' },
  { value: 'custom', label: 'Custom…' },
]

/** Resolve a preset to a concrete date window, relative to `today`. */
export function resolvePeriod(preset: PeriodPreset, today: Date = new Date()): StatementPeriod {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  switch (preset) {
    case 'this_quarter': {
      const qi = q(m)
      const start = new Date(Date.UTC(y, qi * 3, 1))
      const end = new Date(Date.UTC(y, qi * 3 + 3, 0)) // day 0 of next month = last day of this
      return { preset, start: iso(start), end: iso(end), label: `Q${qi + 1} ${y}` }
    }
    case 'last_quarter': {
      const qi = q(m) - 1
      const ly = qi < 0 ? y - 1 : y
      const lq = qi < 0 ? 3 : qi
      const start = new Date(Date.UTC(ly, lq * 3, 1))
      const end = new Date(Date.UTC(ly, lq * 3 + 3, 0))
      return { preset, start: iso(start), end: iso(end), label: `Q${lq + 1} ${ly}` }
    }
    case 'ytd':
      return { preset, start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(today), label: `YTD ${y}` }
    case 'prior_year':
      return {
        preset,
        start: iso(new Date(Date.UTC(y - 1, 0, 1))),
        end: iso(new Date(Date.UTC(y - 1, 11, 31))),
        label: `FY ${y - 1}`,
      }
    case 'itd':
    default:
      return { preset: 'itd', start: null, end: null, label: 'Inception to date' }
  }
}

/** A custom window, for the explicit start/end date inputs. */
export function customPeriod(start: string | null, end: string | null): StatementPeriod {
  return {
    preset: 'custom',
    start: start || null,
    end: end || null,
    label: start && end ? `${start} → ${end}` : end ? `Through ${end}` : start ? `From ${start}` : 'Inception to date',
  }
}
