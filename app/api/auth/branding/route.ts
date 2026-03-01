import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = createAdminClient()

  const { data: fund } = await admin
    .from('funds')
    .select('id, name, logo_url')
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    fundName: fund?.name || null,
    fundLogo: fund?.logo_url || null,
  })
}
