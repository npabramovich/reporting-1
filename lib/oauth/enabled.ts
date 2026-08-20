import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The master switch for the entire agent surface: MCP (OAuth and static-key
 * alike), the REST agent endpoint, API-key creation, and the OAuth consent screen.
 *
 * Admin-only, per fund, and OFF by default — a capability that can post journal
 * entries and close periods should be opt-in. (The migration that adds the column
 * backfills `true` for funds that already had live API keys, so nobody using it
 * today loses it.)
 *
 * It is checked on every request rather than baked into a key or token, so
 * switching it off takes effect immediately for credentials that were already
 * issued. That's the whole point: an admin who suspects a leak flips one switch
 * and the surface goes dark, without having to hunt down every key and token.
 */
export async function agentApiEnabled(
  admin: SupabaseClient,
  fundId: string
): Promise<boolean> {
  const { data } = await (admin as any)
    .from('fund_settings')
    .select('agent_api_enabled')
    .eq('fund_id', fundId)
    .maybeSingle()

  return !!(data as any)?.agent_api_enabled
}
