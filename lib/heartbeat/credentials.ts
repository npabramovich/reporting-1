import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/crypto'

/**
 * Heartbeat credential storage.
 *
 * A Heartbeat API key is issued at the COMMUNITY level and can read every channel
 * — there is no per-user permission scoping to preserve. So unlike the Affinity
 * key (one per user, see lib/affinity/credentials.ts), this is ONE KEY PER FUND,
 * settable only by an admin.
 *
 * Storage follows the repo's envelope-encryption pattern: the key is AES-256-GCM
 * encrypted with the fund's DEK, and the DEK is itself wrapped under the master
 * KEK in process.env.ENCRYPTION_KEY.
 */

async function getOrCreateFundDek(admin: SupabaseClient, fundId: string): Promise<string> {
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) throw new Error('ENCRYPTION_KEY is not configured')

  const { data } = await admin
    .from('fund_settings')
    .select('encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()

  const existing = (data as any)?.encryption_key_encrypted as string | null | undefined
  if (existing) return decrypt(existing, kek)

  const dek = randomBytes(32).toString('hex')
  const { error } = await admin
    .from('fund_settings')
    .update({ encryption_key_encrypted: encrypt(dek, kek) } as any)
    .eq('fund_id', fundId)
  if (error) throw new Error(`Failed to store encryption key: ${error.message}`)
  return dek
}

async function getFundDek(admin: SupabaseClient, fundId: string): Promise<string | null> {
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return null
  const { data } = await admin
    .from('fund_settings')
    .select('encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()
  const enc = (data as any)?.encryption_key_encrypted as string | null | undefined
  if (!enc) return null
  return decrypt(enc, kek)
}

/**
 * Hash a webhook URL token. Heartbeat signs nothing, so this token IS the
 * webhook's authentication — we store only its digest, exactly as one would for a
 * password. SHA-256 without a salt is correct here (unlike for passwords): the
 * token is 256 bits of CSPRNG output, so there is no dictionary to attack, and
 * the lookup must be deterministic to find the fund from an inbound request.
 */
export function hashWebhookSecret(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Mint a new URL token. Returned in the clear exactly once, to build the URL. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

export interface HeartbeatConnection {
  fundId: string
  apiKey: string
  enabled: boolean
}

/**
 * Store (or replace) the fund's Heartbeat key and mint a fresh webhook token.
 *
 * Saving the key ALWAYS re-mints the token, which invalidates every webhook URL
 * previously registered with Heartbeat — the caller is responsible for
 * re-registering. That's deliberate: re-entering the key is the natural place to
 * rotate a URL credential that may have leaked.
 */
export async function saveHeartbeatKey(
  admin: SupabaseClient,
  params: { fundId: string; apiKey: string }
): Promise<{ webhookSecret: string }> {
  const dek = await getOrCreateFundDek(admin, params.fundId)
  const webhookSecret = generateWebhookSecret()

  const { error } = await (admin as any)
    .from('heartbeat_credentials')
    .upsert({
      fund_id: params.fundId,
      api_key_encrypted: encrypt(params.apiKey, dek),
      webhook_secret_hash: hashWebhookSecret(webhookSecret),
      webhook_secret_encrypted: encrypt(webhookSecret, dek),
      enabled: true,
      last_verified_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fund_id' })

  if (error) throw new Error(`Failed to save Heartbeat key: ${error.message}`)
  return { webhookSecret }
}

/**
 * Recover the fund's webhook token so a URL can be rebuilt — used when an admin
 * adds a channel and we need to register a new webhook for it.
 *
 * This is the reason the token is stored encrypted as well as hashed. It is only
 * ever used server-side to construct the URL handed to Heartbeat; it must never
 * be returned to a client.
 */
export async function getWebhookSecret(
  admin: SupabaseClient,
  fundId: string
): Promise<string | null> {
  const { data } = await (admin as any)
    .from('heartbeat_credentials')
    .select('webhook_secret_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!data?.webhook_secret_encrypted) return null

  const dek = await getFundDek(admin, fundId)
  if (!dek) return null

  try {
    return decrypt((data as any).webhook_secret_encrypted as string, dek)
  } catch {
    return null
  }
}

/**
 * Decrypt the fund's Heartbeat key. Returns null when the fund has not connected
 * Heartbeat — callers treat that as "this capability is unavailable", not an error.
 */
export async function getHeartbeatKey(
  admin: SupabaseClient,
  fundId: string
): Promise<string | null> {
  const { data } = await (admin as any)
    .from('heartbeat_credentials')
    .select('api_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!data?.api_key_encrypted) return null

  const dek = await getFundDek(admin, fundId)
  if (!dek) return null

  try {
    return decrypt((data as any).api_key_encrypted as string, dek)
  } catch {
    // Encrypted under a DEK we can no longer reproduce (KEK rotated without
    // re-wrapping). Surface as "not connected" so an admin reconnects.
    return null
  }
}

/**
 * Resolve an inbound webhook's URL token to the fund it belongs to, and hand back
 * the decrypted API key. This is the ONLY authentication on the webhook route —
 * Heartbeat sends no signature — so a token that matches no row must be
 * indistinguishable from one that matches a disabled fund: both return null.
 */
export async function resolveWebhookSecret(
  admin: SupabaseClient,
  token: string
): Promise<HeartbeatConnection | null> {
  const { data } = await (admin as any)
    .from('heartbeat_credentials')
    .select('fund_id, api_key_encrypted, enabled')
    .eq('webhook_secret_hash', hashWebhookSecret(token))
    .maybeSingle()

  if (!data || !data.enabled) return null

  const fundId = (data as any).fund_id as string
  const dek = await getFundDek(admin, fundId)
  if (!dek) return null

  try {
    return {
      fundId,
      apiKey: decrypt((data as any).api_key_encrypted as string, dek),
      enabled: true,
    }
  } catch {
    return null
  }
}

/** Record a failed call so the settings UI can prompt for reconnection. */
export async function markHeartbeatError(
  admin: SupabaseClient,
  fundId: string,
  message: string
): Promise<void> {
  await (admin as any)
    .from('heartbeat_credentials')
    .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('fund_id', fundId)
}

/** Clear the error flag after a call succeeds. */
export async function markHeartbeatOk(
  admin: SupabaseClient,
  fundId: string
): Promise<void> {
  await (admin as any)
    .from('heartbeat_credentials')
    .update({
      last_error: null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('fund_id', fundId)
}

export async function deleteHeartbeatKey(
  admin: SupabaseClient,
  fundId: string
): Promise<void> {
  await (admin as any).from('heartbeat_credentials').delete().eq('fund_id', fundId)
}
