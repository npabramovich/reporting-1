import { describe, it, expect } from 'vitest'
import * as engine from '@hemrock/fund-engine'
import * as ledger from './ledger'
import * as types from './types'
import * as waterfall from './waterfall'
import * as carry from './carry'
import * as americanCarry from './american-carry'
import * as distributionWaterfall from './distribution-waterfall'
import * as allocation from './allocation'
import * as capitalAccount from './capital-account'
import * as textLedger from './text-ledger'
import * as statements from './statements'
import * as xirr from '@/lib/xirr'

// The fund math lives in packages/fund-engine. These modules are its app-side names; they must
// hand back the engine's own functions, never a copy that could drift from what an auditor runs.
describe('lib/accounting re-exports the fund engine', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['ledger', ledger], ['types', types], ['waterfall', waterfall], ['american-carry', americanCarry],
    ['distribution-waterfall', distributionWaterfall], ['allocation', allocation],
    ['capital-account', capitalAccount], ['text-ledger', textLedger], ['xirr', xirr],
  ]
  for (const [name, mod] of cases) {
    it(`${name} is the engine's`, () => {
      const keys = Object.keys(mod)
      expect(keys.length).toBeGreaterThan(0)
      for (const k of keys) expect(mod[k], k).toBe((engine as Record<string, unknown>)[k])
    })
  }

  it('carry and statements share the engine’s pure parts and keep their own loaders', () => {
    for (const k of ['NO_CARRY', 'preferredTarget', 'carryTarget', 'carryAccrual', 'resolveCarryRecipients', 'carryTermsFromRow'] as const) {
      expect(carry[k]).toBe(engine[k])
    }
    expect(typeof carry.loadCarryTerms).toBe('function')
    expect(statements.trialBalance).toBe(engine.trialBalance)
    expect(statements.postingsInPeriod).toBe(engine.postingsInPeriod)
  })

  it('carryTermsFromRow reads a stored row as loadCarryTerms always has', () => {
    expect(engine.carryTermsFromRow(null)).toBe(engine.NO_CARRY)
    expect(engine.carryTermsFromRow({ kind: 'bogus', carry_rate: 0.2 }).kind).toBe('none')
    expect(engine.carryTermsFromRow({ kind: 'european', carry_rate: '0.2', pref_rate: '0.08', catchup_rate: null, pref_compounds: null, gp_entity_id: 'gp', carry_recipients: null }))
      .toEqual({ kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: true, prefBase: 'contributed', gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }] })
  })
})
