import { createAdminClient } from '@/lib/supabase/admin'
import { SignUpForm } from './signup-form'

export const dynamic = 'force-dynamic'

async function getBranding() {
  try {
    const admin = createAdminClient()
    const { data: fund } = await admin
      .from('funds')
      .select('id, name, logo_url')
      .limit(1)
      .maybeSingle()

    return {
      fundName: fund?.name ?? '',
      fundLogo: fund?.logo_url ?? '',
    }
  } catch {
    return { fundName: '', fundLogo: '' }
  }
}

export default async function SignUpPage() {
  const branding = await getBranding()
  return <SignUpForm branding={branding} />
}
