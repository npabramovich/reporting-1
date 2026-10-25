// Pure metadata for the RECYCLING tools: exit proceeds a vehicle puts back to work instead of
// distributing. NO server imports (the Settings key UI lists these). Handlers live in recycling-tools.ts.
//
// All four are LP capital, on ONE vehicle's books, so they bind as ledger tools: the dispatcher
// resolves the vehicle with the caller's access and injects it.
//
//   recycling            → the terms, the cap, what is used and the register; writes nothing
//   set_recycling_terms  → the LPA's recycling clause, always staged for a person to approve
//   record_recycling     → one recycled amount, always staged (deemed posts the netted entry)
//   remove_recycling     → one register row, always staged
//
// The mechanics are in lib/accounting/recycling.ts.

import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'

export const RECYCLING_TERMS_PROPERTIES = {
  capRate: { type: 'number', minimum: 0, maximum: 2, description: 'The cap as a fraction of capBasis (0.2 = 20%). 0 = the fund does not recycle.' },
  capBasis: { type: 'string', enum: ['commitments', 'management_fees'], description: 'What the cap is a share of. Default commitments.' },
  until: { type: ['string', 'null'], description: 'YYYY-MM-DD: proceeds received after this date are not recycled (usually the end of the investment period). Null = no end date.' },
  uses: { type: 'string', enum: ['any', 'new_investments', 'follow_ons'], description: 'What recycled proceeds may fund. Default any.' },
  defaultTreatment: {
    type: 'string', enum: ['retained', 'deemed'],
    description: 'How a recycled amount is booked when it does not say: retained = never distributed (the default), deemed = distributed and recontributed.',
  },
  explanation: { type: 'string', description: 'Why, for the approver: the LPA clause, quoted with its section.' },
} as const

export const RECORD_RECYCLING_PROPERTIES = {
  date: { type: 'string', description: 'When the proceeds were received (YYYY-MM-DD). A deemed amount is booked on this date.' },
  amount: { type: 'number', exclusiveMinimum: 0, description: 'How much of the proceeds to recycle, within what is left of the cap.' },
  treatment: {
    type: 'string', enum: ['retained', 'deemed'],
    description: "retained = never distributed: nothing is posted, the cash stays and later calls are smaller. deemed = distributed and recontributed: one entry with no cash or notices shows each partner a distribution and a contribution of the same amount, split by commitment, and their uncalled commitment is unchanged. Default: the terms' default.",
  },
  companyId: { type: 'string', description: 'The portfolio company whose exit the proceeds came from (list_companies), when there is one.' },
  description: { type: 'string', description: 'A short note, shown on the register and in the entry memo.' },
  explanation: { type: 'string', description: 'Why, for the approver.' },
} as const

export const RECYCLING_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'recycling',
    description:
      "A vehicle's recycling of exit proceeds: its terms (cap and what it is a share of, end date, permitted uses, default " +
      'treatment), the cap in currency, what has been recycled, what is left, and each recycled amount with its treatment ' +
      '(retained = never distributed, deemed = distributed and recontributed) and its entry. Writes nothing.',
    scope: 'read',
    accessDomain: 'lp_capital',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_recycling_terms',
    description:
      "Ask for a vehicle's recycling terms to be set from its LPA: the cap (a share of commitments or of management fees), the " +
      'date recycling ends, what recycled proceeds may fund, and the default treatment. Always staged: a person with LP ' +
      "capital write reviews today's terms beside the new ones and approves. The carry terms are not touched.",
    scope: 'write',
    accessDomain: 'lp_capital',
    stagesAs: 'set_recycling_terms',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...RECYCLING_TERMS_PROPERTIES } },
  },
  {
    name: 'record_recycling',
    description:
      'Ask for part of an exit\'s proceeds to be recycled instead of distributed, within the cap. Retained posts nothing; ' +
      'deemed posts one netted entry (a distribution and a recontribution per partner, no cash, no notices) that shows on ' +
      'their next statement and K-1. Always staged: the approver sees the cap, what is left, and each partner\'s share.',
    scope: 'write',
    accessDomain: 'lp_capital',
    stagesAs: 'record_recycling',
    inputSchema: { type: 'object', required: ['date', 'amount'], additionalProperties: false, properties: { ...RECORD_RECYCLING_PROPERTIES } },
  },
  {
    name: 'remove_recycling',
    description:
      'Ask for a recycled amount to be taken off the register (the recycling tool lists their ids). A deemed amount\'s entry ' +
      'has to be voided first, with a reason. Always staged.',
    scope: 'write',
    accessDomain: 'lp_capital',
    stagesAs: 'remove_recycling',
    inputSchema: {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string', description: 'The recycled amount (recycling lists them).' }, explanation: { type: 'string' } },
    },
  },
]
