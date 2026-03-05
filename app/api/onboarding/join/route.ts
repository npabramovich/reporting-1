import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { dbError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  // Rate limit: 10 requests per 5 minutes per IP
  const limited = await rateLimit({ key: `onboard-join:${getClientIp(req)}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fundId } = await req.json()
  if (!fundId) return NextResponse.json({ error: 'fundId is required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify the fund exists and the user's email domain matches
  const { data: fund } = await admin
    .from('funds')
    .select('id, name, email_domain')
    .eq('id', fundId)
    .single()

  if (!fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 })

  const userDomain = user.email?.split('@')[1]?.toLowerCase()
  if (!userDomain || fund.email_domain?.toLowerCase() !== userDomain) {
    return NextResponse.json({ error: 'Email domain does not match this fund' }, { status: 403 })
  }

  // Check if already a member
  const { data: existing } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', fundId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You are already a member of this fund' }, { status: 400 })
  }

  // Check for existing pending request
  const { data: existingRequest } = await admin
    .from('fund_join_requests')
    .select('id, status')
    .eq('fund_id', fundId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingRequest) {
    return NextResponse.json({
      error: existingRequest.status === 'pending'
        ? 'You already have a pending request'
        : 'A previous request was already processed',
    }, { status: 400 })
  }

  // Create join request
  const { error } = await admin
    .from('fund_join_requests')
    .insert({
      fund_id: fundId,
      user_id: user.id,
      email: user.email!,
      status: 'pending',
    })

  if (error) return dbError(error, 'onboarding-join')

  return NextResponse.json({ ok: true, fundName: fund.name })
}
