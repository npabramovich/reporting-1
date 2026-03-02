import type { SupabaseClient } from '@supabase/supabase-js'

interface DropboxCredentials {
  appKey: string
  appSecret: string
}

/**
 * Get Dropbox app credentials for a fund from the database.
 */
export async function getDropboxCredentials(
  admin: SupabaseClient,
  fundId: string
): Promise<DropboxCredentials | null> {
  const { data: settings } = await admin
    .from('fund_settings')
    .select('dropbox_app_key, dropbox_app_secret_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (settings?.dropbox_app_key && settings?.dropbox_app_secret_encrypted && settings?.encryption_key_encrypted) {
    const kek = process.env.ENCRYPTION_KEY
    if (kek) {
      const { decrypt } = await import('@/lib/crypto')
      const dek = decrypt(settings.encryption_key_encrypted, kek)
      const appSecret = decrypt(settings.dropbox_app_secret_encrypted, dek)
      return {
        appKey: settings.dropbox_app_key,
        appSecret,
      }
    }
  }

  return null
}
