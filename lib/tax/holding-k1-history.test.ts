import { describe, it, expect } from 'vitest'
import { holdingK1History, k1YearColumns } from './holding-k1-history'

// Invented figures throughout.

describe('k1YearColumns', () => {
  it('folds the boxes the way this fund’s own K-1s do', () => {
    const c = k1YearColumns({
      ordinaryBusinessIncome: -2_000, guaranteedPayments: 500, interest: 1_000, ordinaryDividends: 4_000, qualifiedDividends: 3_000,
      shortTermGain: 500, longTermGain: 10_000, section1231Gain: 1_500, netRentalRealEstate: 200, royalties: 100, otherIncome: 50,
      section179: 10, investmentInterest: 300, otherDeductions: 700, distributionsCash: 8_000, distributionsProperty: 1_000,
      capitalEnding: 120_000,
    })
    expect(c).toEqual({
      ordinary: -1_500, interest: 1_000, dividends: 4_000, shortTermGain: 500, longTermGain: 10_000,
      other: 1_850, deductions: 1_010, total: 14_840, distributions: 9_000,
    })
  })

  it('reads an empty K-1 as zeros', () => {
    expect(k1YearColumns({}).total).toBe(0)
  })
})

describe('holdingK1History', () => {
  const rows = [
    { tax_year: 2023, vehicle_id: 'veh-1', status: 'received', amounts_recorded_at: '2024-03-01', box5_interest: 100 },
    { tax_year: 2024, vehicle_id: 'veh-1', status: 'amended', amounts_recorded_at: '2025-03-01', box9a_net_long_term_gain: 1_000, box19a_distributions_cash: 400 },
    // Arrived, amounts not entered.
    { tax_year: 2022, vehicle_id: 'veh-1', status: 'received', amounts_recorded_at: null },
    // Not owed this year.
    { tax_year: 2021, vehicle_id: 'veh-1', status: 'not_expected', amounts_recorded_at: '2022-03-01', box5_interest: 9 },
    // Another entity's K-1, and one recorded without an entity.
    { tax_year: 2024, vehicle_id: 'veh-2', status: 'received', amounts_recorded_at: '2025-03-01', box5_interest: 50 },
    { tax_year: 2024, vehicle_id: null, status: 'received', amounts_recorded_at: '2025-03-01', box5_interest: 70 },
  ]

  it('lists the years with recorded amounts, newest first', () => {
    const all = holdingK1History(rows, () => true)
    expect(all.map(r => [r.taxYear, r.vehicleId])).toEqual([[2024, null], [2024, 'veh-1'], [2024, 'veh-2'], [2023, 'veh-1']])
    const y2024 = all.find(r => r.taxYear === 2024 && r.vehicleId === 'veh-1')!
    expect(y2024).toMatchObject({ longTermGain: 1_000, total: 1_000, distributions: 400, status: 'amended' })
  })

  it('leaves out the entities the viewer cannot see', () => {
    const mine = holdingK1History(rows, v => v === 'veh-1')
    expect(mine.map(r => r.vehicleId)).toEqual(['veh-1', 'veh-1'])
  })
})
