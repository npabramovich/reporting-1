// The input of `set_waterfall_terms`: ONE schema, imported by both the tool's manifest (which must
// stay free of server imports) and the pending action it stages (lib/pending-actions/registry.ts),
// so the two cannot drift. tests/pending-actions-registry.test.ts checks they agree.

const RATE = (what: string) => ({ type: 'number', description: `${what}, as a FRACTION (0.2 = 20%).` })

export const SET_WATERFALL_TERMS_SCHEMA = {
  type: 'object',
  required: ['kind'],
  properties: {
    vehicle: { type: 'string', description: 'The vehicle (portfolio_group).' },
    kind: { type: 'string', enum: ['none', 'straight', 'american', 'european'], description: 'none: no carry. straight: carryRate of profit over contributed capital. european: whole-fund return of capital, preferred return, GP catch-up, split. american: deal-by-deal, where a distribution returns the capital in deals realized so far (losers included) before carry; the close still accrues the whole-fund result. See docs/spec/waterfall-terms.md.' },
    carryRate: RATE('The GP\'s carry share of profits, below 1'),
    prefRate: RATE('The annual preferred return (hurdle), below 1; ignored by straight'),
    catchupRate: RATE('The GP\'s share of each dollar while it catches up, 0 to 1: 1 = all of it, 0 = no catch-up; ignored by straight'),
    catchupSize: RATE('How much of a full catch-up the GP gets, 0 to 1 (default 1). A full catch-up is the carry the GP would have earned on the profit that paid the preferred return; 0.5 is half of it. Ignored by straight'),
    prefCompounds: { type: 'boolean', description: 'Whether the preferred return compounds annually (default true) or is simple.' },
    prefBase: { type: 'string', enum: ['contributed', 'unreturned'], description: 'What the preferred return accrues on: contributed (every contribution, even once returned; the default) or unreturned (only capital not yet returned, plus unpaid pref when it compounds). Omitting it sets contributed.' },
    prefMultiple: { type: 'number', description: 'A hurdle set as a multiple of capital instead of a rate: the LPs get this multiple of their capital back before the catch-up, however long it takes (1.08 = an 8% hurdle that never accrues). Omit for the rate.' },
    prefDayCount: { type: 'string', enum: ['act/365', '30/360'], description: 'How the preferred return counts years: act/365 (actual days, the default) or 30/360 (US bond basis).' },
    catchupMeasure: { type: 'string', enum: ['preferred', 'profit'], description: 'What the catch-up is measured on. preferred (the default): the GP gets carryRate / (1 − carryRate) of the pref paid, whatever the LPs got of the catch-up flow ("an amount equal to 25% of the preferred return"). profit: the GP catches up until it holds its share of all profit distributed ("until the GP has received 20% of the amounts distributed under (ii) and (iii)"). They differ only when catchupRate is below 1.' },
    carryRecipients: {
      type: 'array',
      description: 'Who receives the carry, with percentages that total 100. Required when carry is on, unless gpEntityId is given.',
      items: {
        type: 'object',
        required: ['lpEntityId', 'pct'],
        properties: { lpEntityId: { type: 'string' }, pct: { type: 'number', description: '0 to 100' } },
      },
    },
    gpEntityId: { type: 'string', description: 'Legacy single recipient at 100%; prefer carryRecipients.' },
    documentId: { type: 'string', description: 'The entity document the terms were read from (extract_lpa_terms gives it); the approver sees each quote checked against it.' },
    sources: {
      type: 'array',
      description: 'Where each term came from, as extract_lpa_terms returns it in proposedTerms.sources.',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          quote: { type: 'string' },
          section: { type: 'string' },
          page: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    explanation: { type: 'string', description: 'Why, in a sentence, for the approver.' },
  },
} as const
