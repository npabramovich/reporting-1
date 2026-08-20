import { AffinityClient, AffinityError, renderNoteAsMarkdown } from '@/lib/affinity/client'
import type { ToolDefinition, ToolExecutor, ToolInvocation, McpServerConfig } from '@/lib/ai/types'

/**
 * Affinity tools for the diligence assistant.
 *
 * These are READ-ONLY by construction. The assistant answers questions about
 * relationship history ("what did we discuss with Acme last quarter?", "who
 * introduced us?") — it has no reason to write to the fund's CRM, and giving a
 * model write access to a system of record is a much larger blast radius than
 * the feature needs.
 *
 * The alternative path is Affinity's hosted MCP server (see `affinityMcpServer`
 * below), which exposes their full tool surface INCLUDING writes. That's opt-in
 * per fund precisely because of the above.
 */

export const AFFINITY_TOOLS: ToolDefinition[] = [
  {
    name: 'affinity_search_companies',
    description:
      'Search the fund\'s Affinity CRM for companies by name or domain. Use this to find the ' +
      'Affinity record for a company before looking up its notes. Returns company names, ' +
      'domains, and Affinity organization IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Company name or domain to search for, e.g. "Acme" or "acme.com".',
        },
      },
      required: ['term'],
      additionalProperties: false,
    },
  },
  {
    name: 'affinity_get_notes',
    description:
      'Fetch the notes the fund has written in Affinity about a company — call notes, meeting ' +
      'summaries, AI notetaker transcripts, partner commentary. This is the fund\'s relationship ' +
      'history with the company. Requires an Affinity organization ID from affinity_search_companies ' +
      '(or the one already linked to this deal).',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: {
          type: 'number',
          description: 'The Affinity organization ID.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return, most recent first. Default 20, max 50.',
        },
      },
      required: ['organization_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'affinity_list_files',
    description:
      'List the files attached to a company in Affinity (decks, models, memos someone uploaded ' +
      'to the CRM). Returns file names and sizes — not contents. Use it to tell the partner what ' +
      'exists in Affinity that is not yet in the deal data room.',
    inputSchema: {
      type: 'object',
      properties: {
        organization_id: {
          type: 'number',
          description: 'The Affinity organization ID.',
        },
      },
      required: ['organization_id'],
      additionalProperties: false,
    },
  },
]

/**
 * Build an executor bound to one user's Affinity key. What the assistant can see
 * is exactly what that user can see in Affinity — the key carries their
 * permissions, so this cannot be used to read past them.
 */
export function makeAffinityExecutor(apiKey: string): ToolExecutor {
  const client = new AffinityClient(apiKey)

  return async (call: ToolInvocation): Promise<string> => {
    try {
      switch (call.name) {
        case 'affinity_search_companies': {
          const term = String(call.input.term ?? '').trim()
          if (!term) return 'No search term provided.'
          const orgs = await client.searchOrganizations(term)
          if (orgs.length === 0) return `No companies in Affinity match "${term}".`
          return orgs
            .slice(0, 10)
            .map(o => `- ${o.name} (organization_id: ${o.id}${o.domain ? `, domain: ${o.domain}` : ''})`)
            .join('\n')
        }

        case 'affinity_get_notes': {
          const organizationId = Number(call.input.organization_id)
          if (!Number.isFinite(organizationId)) return 'A valid organization_id is required.'
          const limit = Math.min(Number(call.input.limit) || 20, 50)

          const { notes } = await client.listNotes({ organizationId }, limit)
          if (notes.length === 0) return 'No notes found in Affinity for this company.'

          // Newest first — a partner asking "what did we discuss last quarter"
          // cares about recent history, and the model reads top-down.
          const sorted = [...notes].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )

          return sorted
            .slice(0, limit)
            .map(n => renderNoteAsMarkdown(n, {}))
            .join('\n\n---\n\n')
            // Hard cap the payload: a chatty CRM can hold hundreds of KB of
            // notes, which would blow the context window and the bill.
            .slice(0, 40_000)
        }

        case 'affinity_list_files': {
          const organizationId = Number(call.input.organization_id)
          if (!Number.isFinite(organizationId)) return 'A valid organization_id is required.'
          const files = await client.listEntityFiles({ organizationId })
          if (files.length === 0) return 'No files are attached to this company in Affinity.'
          return files
            .map(f => `- ${f.name} (${formatSize(f.size)}, uploaded ${f.created_at?.slice(0, 10) ?? 'unknown'})`)
            .join('\n')
        }

        default:
          return `Unknown tool: ${call.name}`
      }
    } catch (err) {
      // Surfaced back to the model as a tool error so it can tell the partner
      // "I couldn't reach Affinity" instead of inventing an answer.
      if (err instanceof AffinityError) return `Affinity error: ${err.message}`
      return err instanceof Error ? `Affinity error: ${err.message}` : 'Affinity lookup failed.'
    }
  }
}

/**
 * Affinity's hosted MCP server. Opt-in per fund.
 *
 * Trade-offs vs. the custom tools above:
 *   + Full Affinity tool surface, maintained by Affinity, zero tool code here.
 *   - Anthropic-only (the MCP connector is an Anthropic API feature).
 *   - Requires an Affinity Scale/Advanced/Enterprise plan.
 *   - Includes WRITE tools — the model can log notes back into the CRM.
 */
export function affinityMcpServer(apiKey: string): McpServerConfig {
  return {
    name: 'affinity',
    url: 'https://mcp.affinity.co/mcp',
    authorizationToken: apiKey,
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return 'unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
