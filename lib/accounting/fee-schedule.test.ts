import { describe, expect, it } from 'vitest'
import { parseFeeScheduleInput } from './fee-schedule'

describe('parseFeeScheduleInput', () => {
  const base = { frequency: 'quarterly', start: '2026-01-01', end: '2036-01-01' }

  it('keeps a schedule with a step-down, in date order', () => {
    expect(parseFeeScheduleInput({
      ...base,
      steps: [{ from: '2031-01-01', rate: 0.015, basis: 'invested' }, { from: '2026-01-01', rate: 0.02, basis: 'commitments' }],
      organizationalExpenseCap: '500000',
    })).toEqual({ ok: true, value: {
      ...base,
      steps: [{ from: '2026-01-01', rate: 0.02, basis: 'commitments' }, { from: '2031-01-01', rate: 0.015, basis: 'invested' }],
      organizationalExpenseCap: 500_000,
    } })
  })

  it('clears with null', () => {
    expect(parseFeeScheduleInput(null)).toEqual({ ok: true, value: null })
  })

  it('refuses what the settings page refuses', () => {
    const steps = [{ from: '2026-01-01', rate: 0.02, basis: 'commitments' }]
    expect(parseFeeScheduleInput({ ...base, frequency: 'monthly', steps })).toEqual({ error: 'The fee is charged quarterly, semiannually or annually.' })
    expect(parseFeeScheduleInput({ ...base, end: '2025-01-01', steps })).toEqual({ error: 'The fee schedule needs an end date after its start.' })
    expect(parseFeeScheduleInput({ ...base, steps: [] })).toEqual({ error: 'The fee schedule needs at least one rate.' })
    expect(parseFeeScheduleInput({ ...base, steps: [{ ...steps[0], rate: 2 }] })).toEqual({ error: 'Each rate is an annual fraction between 0 and 0.2 (0.02 = 2%).' })
    expect(parseFeeScheduleInput({ ...base, steps: [{ ...steps[0], basis: 'called' }] })).toEqual({ error: 'Each rate is charged on commitments, invested capital or NAV.' })
    expect(parseFeeScheduleInput({ ...base, steps: [{ ...steps[0], from: '2027-01-01' }] })).toEqual({ error: 'The first rate must start on or before the schedule does.' })
  })
})
