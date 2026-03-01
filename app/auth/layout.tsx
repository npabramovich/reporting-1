import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  let branding = { fundName: '', fundLogo: '', authSubtitle: '', authContact: '' }

  try {
    const admin = createAdminClient()

    const { data: fund } = await admin
      .from('funds')
      .select('id, name, logo_url')
      .limit(1)
      .maybeSingle()

    if (fund) {
      const { data: settings } = await admin
        .from('fund_settings')
        .select('auth_subtitle, auth_contact')
        .eq('fund_id', fund.id)
        .maybeSingle()

      branding = {
        fundName: fund.name ?? '',
        fundLogo: fund.logo_url ?? '',
        authSubtitle: (settings as Record<string, unknown> | null)?.auth_subtitle as string ?? '',
        authContact: (settings as Record<string, unknown> | null)?.auth_contact as string ?? '',
      }
    }
  } catch {
    // Branding is non-critical; render with defaults
  }

  return (
    <>
      <script
        id="auth-branding"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(branding) }}
      />
      {children}
    </>
  )
}
