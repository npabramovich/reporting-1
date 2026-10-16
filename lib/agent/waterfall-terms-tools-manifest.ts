// Pure metadata for the WATERFALL TERMS tools: a vehicle's carry terms, read, proposed from its LPA,
// and set. NO server imports (the Settings key UI lists these). Handlers live in waterfall-terms-tools.ts.
//
// All three are GP economics (the partners' carry), on ONE vehicle's books, so they bind as ledger
// tools: the dispatcher resolves the vehicle with the caller's access and injects it.
//
//   waterfall_terms     → api/accounting/waterfall-terms (GET)
//   extract_lpa_terms   → reads an LPA (an entity document, or pasted text) into a PROPOSAL; writes nothing
//   set_waterfall_terms → api/accounting/waterfall-terms (PUT), always staged for a person to approve
//
// The terms themselves are specified in docs/spec/waterfall-terms.md.

import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'
import { SET_WATERFALL_TERMS_SCHEMA } from '@/lib/accounting/waterfall-terms-schema'

export const WATERFALL_TERMS_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'waterfall_terms',
    description:
      "A vehicle's carry (waterfall) terms as the close and distributions use them: kind (none, straight, american, european), " +
      'carry rate, preferred return and whether it compounds, GP catch-up, and who receives the carry (with names). Rates are ' +
      'fractions (0.2 = 20%). No terms set means no carry.',
    scope: 'read',
    accessDomain: 'gp_economics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'extract_lpa_terms',
    description:
      "Read a vehicle's waterfall terms out of its LPA and return them as a PROPOSAL in the engine's shape: each term with the " +
      'clause it came from (quoted, with section and page), a confidence, and whether the quote was found in the document; the ' +
      'terms it could not find; and provisions the engine does not model (GP clawback, fee offsets, multiple hurdles). Pass ' +
      'documentId (list_entity_documents) or text. With a server AI key the fund\'s model reads it; without one you get a ' +
      'pattern reading plus the relevant passages: read them and call again with assistantProposal, which is checked the same ' +
      'way. Writes NOTHING: apply it with set_waterfall_terms, which is staged for approval.',
    scope: 'read',
    accessDomain: 'gp_economics',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: "One of the vehicle's entity documents (list_entity_documents), normally the LPA." },
        text: { type: 'string', description: 'The LPA text, pasted, when it is not stored as a document (up to 1,000,000 characters).' },
        assistantProposal: {
          type: 'object',
          description: 'Your own reading of the passages, in the responseShape a keyless call returns. Checked against the document like a model\'s.',
        },
        useServerModel: { type: 'boolean', description: 'Default true: use the fund\'s model when it has a key. false returns the pattern reading and passages.' },
      },
    },
  },
  {
    name: 'set_waterfall_terms',
    description:
      "Ask for a vehicle's carry (waterfall) terms to be set: kind, carry rate, preferred return and compounding, GP catch-up, " +
      'and who receives the carry. Always staged, from any connection: a person with GP economics write reviews today\'s terms ' +
      'beside the new ones, with each term\'s LPA clause re-checked against the document, and approves it. Pass ' +
      'extract_lpa_terms\'s proposedTerms (with documentId and sources) after the person has confirmed them. Rates are fractions.',
    scope: 'write',
    accessDomain: 'gp_economics',
    stagesAs: 'set_waterfall_terms',
    // The pending action's own schema (lib/accounting/waterfall-terms-schema.ts); registry tests keep them in step.
    inputSchema: SET_WATERFALL_TERMS_SCHEMA as any,
  },
]
