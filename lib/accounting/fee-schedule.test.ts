import { describe, expect, it } from 'vitest'
import { chargeScheduledFee, parseFeeScheduleInput, type SchedulePayer, type StoredFeeSchedule } from './fee-schedule'

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

  it('keeps the offsets that apply, as shares', () => {
    const steps = [{ from: '2026-01-01', rate: 0.02, basis: 'commitments' }]
    expect(parseFeeScheduleInput({ ...base, steps, offsets: { transaction: 1, monitoring: '0.5', directors: '', other: 0 } })).toEqual({
      ok: true, value: { ...base, steps, offsets: { transaction: 1, monitoring: 0.5 } },
    })
    expect(parseFeeScheduleInput({ ...base, steps, offsets: {} })).toEqual({ ok: true, value: { ...base, steps } })
    expect(parseFeeScheduleInput({ ...base, steps, offsets: { transaction: 1.5 } })).toEqual({ error: 'Each offset is a share between 0 and 1 (1 = 100%).' })
    expect(parseFeeScheduleInput({ ...base, steps, offsets: { closing: 1 } })).toEqual({ error: '"closing" is not a kind of portfolio-company fee.' })
  })
})

describe('chargeScheduledFee', () => {
  const schedule: StoredFeeSchedule = {
    frequency: 'annual',
    start: '2026-01-01',
    end: '2030-01-01',
    steps: [{ from: '2026-01-01', rate: 0.02, basis: 'commitments' }, { from: '2028-01-01', rate: 0, basis: 'commitments' }],
  }
  const facts = { investments: [], exits: [], navs: [], organizationalExpenses: [], portfolioFees: [] }
  const payer = (lpEntityId: string, commitment: number, rateOverride: number | null = null, exempt = false): SchedulePayer =>
    ({ lpEntityId, commitment, rateOverride, exempt })

  it('charges a side letter its own rate, which lowers the total', () => {
    const payers = [payer('lp-a', 600_000), payer('lp-b', 400_000, 0.01)]
    const r = chargeScheduledFee(schedule, payers, '2026-06-30', facts)!
    expect(r.fee.total).toBe(16_000)
    expect(r.fee.lines).toEqual([
      { lpEntityId: 'lp-a', basisAmount: 600_000, rate: 0.02, fee: 12_000 },
      { lpEntityId: 'lp-b', basisAmount: 400_000, rate: 0.01, fee: 4_000 },
    ])
  })

  it('leaves an exempt partner out and keeps a zero-rate step at zero', () => {
    const payers = [payer('lp-a', 600_000), payer('lp-b', 400_000, 0.01), payer('gp', 100_000, null, true)]
    expect(chargeScheduledFee(schedule, payers, '2026-06-30', facts)!.fee.lines.find(l => l.lpEntityId === 'gp')).toEqual(
      { lpEntityId: 'gp', basisAmount: 100_000, rate: 0, fee: 0 },
    )
    const later = chargeScheduledFee(schedule, payers, '2028-06-30', facts)!
    expect(later.fee.total).toBe(0)
    expect(later.fee.lines.every(l => l.fee === 0 && l.rate === 0)).toBe(true)
  })

  it('shares an offset in proportion to each rate group\'s fee, and the lines add up to the net', () => {
    const payers = [payer('lp-a', 333_333), payer('lp-b', 333_333, 0.01), payer('lp-c', 333_334)]
    const r = chargeScheduledFee({ ...schedule, offsets: { transaction: 1 } }, payers, '2026-06-30', {
      ...facts,
      portfolioFees: [{ date: '2026-03-31', kind: 'transaction', amount: 5_000 }],
    })!
    expect(r.fee.total).toBeCloseTo(r.period.net, 2)
    expect(r.fee.total).toBeCloseTo(16_666.66 - 5_000, 0)
    const a = r.fee.lines.find(l => l.lpEntityId === 'lp-a')!.fee
    const b = r.fee.lines.find(l => l.lpEntityId === 'lp-b')!.fee
    expect(a / b).toBeCloseTo(2, 2)
  })

  it('is null outside the schedule', () => {
    expect(chargeScheduledFee(schedule, [payer('lp-a', 100_000)], '2031-01-01', facts)).toBeNull()
  })
})
