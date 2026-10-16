import { describe, it, expect, vi } from 'vitest'

// The server model must never be called from a test: a fund with no key never reaches it, and
// these modules fail loudly if it is.
vi.mock('@/lib/ai', () => ({ createFundAIProvider: () => { throw new Error('no live AI in tests') } }))

import { extractLpaTerms } from './lpa-terms-run'

const FUND = 'fund-1'
const VEHICLE = 'veh-1'

const LPA = `[Page 9]
Section 7.1 Distributions
(i) first, 100% to the Limited Partners until they have received their aggregate Capital Contributions;
(ii) second, 100% to the Limited Partners until they have received a preferred return of 8% per annum, compounded annually;
(iii) third, 100% to the General Partner as a catch-up until the General Partner has received 20% of all amounts distributed under (ii) and (iii);
(iv) thereafter, 80% to the Limited Partners and 20% to the General Partner.`

/** A tiny in-memory stand-in for the supabase query builder: eq/in filters, maybeSingle, thenable. */
function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q },
        in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q },
        contains: () => { rows = []; return q },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      }
      return q
    },
  } as any
}

function tables(over: Partial<Record<string, any[]>> = {}) {
  return {
    fund_vehicles: [{ id: VEHICLE, fund_id: FUND, name: 'Example Fund' }],
    fund_settings: [{ fund_id: FUND }], // no provider key
    vehicle_waterfall_terms: [],
    entity_documents: [{ id: 'doc-1', fund_id: FUND, vehicle_id: VEHICLE, kind: 'lpa', title: 'LPA', effective_date: null, extracted_text: LPA, ocr_status: 'none' }],
    lp_entities: [
      { id: 'gp-entity', fund_id: FUND, entity_name: 'Example GP LLC', partner_class: 'gp' },
      { id: 'lp-entity', fund_id: FUND, entity_name: 'An LP', partner_class: 'lp' },
    ],
    ...over,
  }
}

const ctx = { fundId: FUND, group: 'Example Fund', userId: 'user-1' }

describe('extractLpaTerms', () => {
  it('without a server key: a pattern reading, the passages to read, and proposed terms ready to stage', async () => {
    const r = await extractLpaTerms(fakeAdmin(tables()), ctx, { documentId: 'doc-1' })
    expect(r.written).toBe(false)
    expect(r.method).toBe('heuristic')
    expect(r.source).toMatchObject({ id: 'doc-1', title: 'LPA', kind: 'LPA' })
    expect(r.passages?.length).toBeGreaterThan(0)
    expect(r.responseShape).toMatch(/carryRate/)
    expect(r.next).toMatch(/assistantProposal/)
    expect(r.proposedTerms).toMatchObject({
      vehicle: 'Example Fund', kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: true,
      documentId: 'doc-1',
      // No recipient yet, and the fund has exactly one GP-class partner: suggested, and said so.
      carryRecipients: [{ lpEntityId: 'gp-entity', pct: 100 }],
    })
    expect(r.filledFrom.carryRecipients).toBe('suggested')
    expect(r.proposal.warnings.join(' ')).toMatch(/Example GP LLC .* is suggested/)
  })

  it("checks the assistant's own reading against the document, and keeps today's recipients", async () => {
    const t = tables({
      vehicle_waterfall_terms: [{ fund_id: FUND, vehicle_id: VEHICLE, kind: 'european', carry_rate: 0.15, pref_rate: 0.06, catchup_rate: 1, pref_compounds: true, gp_entity_id: 'gp-entity', carry_recipients: null }],
    })
    const r = await extractLpaTerms(fakeAdmin(t), ctx, {
      documentId: 'doc-1',
      assistantProposal: {
        kind: { value: 'european', quote: '(i) first, 100% to the Limited Partners until they have received their aggregate Capital Contributions', confidence: 'high' },
        carryRate: { value: 0.25, quote: '25% to the General Partner', confidence: 'high' },
        prefRate: { value: 0.08, quote: 'a preferred return of 8% per annum, compounded annually', confidence: 'high' },
      },
    })
    expect(r.method).toBe('assistant')
    expect(r.passages).toBeUndefined()
    expect(r.current.recipientNames).toEqual({ 'gp-entity': 'Example GP LLC' })
    // The invented quote is caught, and the pattern reader's disagreement is reported.
    expect(r.proposal.terms.carryRate).toMatchObject({ value: 0.25, confidence: 'low', quoteVerified: false })
    expect(r.proposal.warnings.join('\n')).toMatch(/carryRate: the reading says 0.25, the pattern reader found 0.2/)
    expect(r.proposedTerms).toMatchObject({ carryRate: 0.25, catchupRate: 1, carryRecipients: [{ lpEntityId: 'gp-entity', pct: 100 }] })
    expect(r.filledFrom).toMatchObject({ catchupRate: 'current', prefCompounds: 'current', carryRecipients: 'current' })
  })

  it('takes pasted text, and refuses both or neither source', async () => {
    const r = await extractLpaTerms(fakeAdmin(tables()), ctx, { text: LPA })
    expect(r.source).toEqual({ pasted: true, chars: LPA.length })
    await expect(extractLpaTerms(fakeAdmin(tables()), ctx, {})).rejects.toThrow(/documentId .* or text/)
    await expect(extractLpaTerms(fakeAdmin(tables()), ctx, { text: LPA, documentId: 'doc-1' })).rejects.toThrow(/not both/)
  })

  it("only reads this vehicle's own documents", async () => {
    const t = tables({ entity_documents: [{ id: 'doc-2', fund_id: FUND, vehicle_id: 'another-vehicle', kind: 'lpa', title: 'Other', extracted_text: LPA }] })
    await expect(extractLpaTerms(fakeAdmin(t), ctx, { documentId: 'doc-2' })).rejects.toThrow(/No such document on Example Fund/)
  })

  it('says so when a scan is still being read', async () => {
    const t = tables({ entity_documents: [{ id: 'doc-1', fund_id: FUND, vehicle_id: VEHICLE, kind: 'lpa', title: 'LPA', extracted_text: null, ocr_status: 'pending' }] })
    await expect(extractLpaTerms(fakeAdmin(t), ctx, { documentId: 'doc-1' })).rejects.toThrow(/still being read/)
  })
})
