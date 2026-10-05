import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_AUTH_BRAND, type AuthBrand } from '@/lib/auth-brand-shared'

/**
 * What the signed-out screens show above the form: the fund's sign-in logo and line of text,
 * from Settings → Fund. Unset, the logo is Hemrock's mark and there is no text.
 *
 * A deployment hosts one fund (lib/pwa.ts loadPwaBrand resolves it the same way), and these
 * screens have no session, so the read is the service role's. Never throws: a fresh install
 * with no fund row, or a build with no database, gets the defaults.
 */
export const loadAuthBrand = unstable_cache(
  async (): Promise<AuthBrand> => {
    try {
      const admin = createAdminClient()
      const { data: fund } = await admin.from('funds').select('id').limit(1).single()
      if (!fund) return DEFAULT_AUTH_BRAND
      // Star select: the columns ship in 20261005120000_sign_in_branding.sql, and a database
      // that hasn't run it should read as unset rather than fail the sign-in page.
      const { data: settings } = await (admin as any).from('fund_settings').select('*').eq('fund_id', fund.id).maybeSingle()
      return {
        logo: typeof settings?.sign_in_logo === 'string' && settings.sign_in_logo ? settings.sign_in_logo : null,
        title: typeof settings?.sign_in_title === 'string' && settings.sign_in_title.trim() ? settings.sign_in_title.trim() : null,
      }
    } catch {
      return DEFAULT_AUTH_BRAND
    }
  },
  ['auth-brand'],
  // The tags the settings route expires, so a change in Settings shows on the next load.
  { tags: ['fund-data', 'fund-settings'], revalidate: 300 }
)
