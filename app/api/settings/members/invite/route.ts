import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email } = await req.json()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify caller is admin of their fund
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can invite members' }, { status: 403 })
  }

  const fundId = membership.fund_id

  // 1. Check if the user is already in the fund
  const { data: existingUser } = await admin.auth.admin.listUsers()
  const targetUser = existingUser.users.find(u => u.email === email)

  let invitedUserId: string

  if (targetUser) {
    // User already exists in the auth.users system
    invitedUserId = targetUser.id
    const { data: existingMembership } = await admin
      .from('fund_members')
      .select('id')
      .eq('user_id', invitedUserId)
      .eq('fund_id', fundId)
      .maybeSingle()

    if (existingMembership) {
      return NextResponse.json({ error: 'User is already a member of this fund' }, { status: 400 })
    }
  } else {
    // User does not exist, send an invite via Supabase Auth GenerateLink
    // We generate the link server-side and extract the token_hash to avoid PKCE cookie errors cross-origin
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'https://funds.catalizadores.com'
    const { data: inviteData, error: inviteError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${origin}/dashboard` }
    })
    
    if (inviteError || !inviteData.user || !inviteData.properties?.hashed_token) {
      console.error('[invite] Failed to generate invite link:', inviteError)
      return NextResponse.json({ error: 'Failed to generate invite token' }, { status: 500 })
    }
    
    invitedUserId = inviteData.user.id

    // Construct the direct OTP link
    const actionLink = `${origin}/auth/callback?token_hash=${inviteData.properties.hashed_token}&type=invite&next=/dashboard`
    
    // We will return this link so the admin can copy it.
    // Try to send email via the fund's outbound provider.
    try {
      const { getOutboundConfig, sendOutboundEmail } = await import('@/lib/email')
      const config = await getOutboundConfig(admin, fundId, 'system')
      if (config) {
        const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).single()
        const fundName = fund?.name || 'our fund'
        await sendOutboundEmail(config, {
          to: email,
          subject: `You've been invited to join ${fundName}`,
          html: `<p>You have been invited to join <strong>${fundName}</strong>.</p><p><a href="${actionLink}">Click here to accept the invitation</a></p><p>Or copy this link: <br> ${actionLink}</p>`
        })
      }
    } catch (e) {
      console.error('[invite] Could not send custom invite email:', e)
      // We don't fail the request, we just return the link in the response.
    }

    return NextResponse.json({ success: true, inviteLink: actionLink })
  }

  // 2. Insert the user into the fund_members table
  const { error: insertError } = await admin
    .from('fund_members')
    .insert({
      fund_id: fundId,
      user_id: invitedUserId,
      role: 'member',
      invited_by: user.id
    })

  if (insertError) {
    console.error('[invite] Failed to inert into fund_members:', insertError)
    // Avoid leaking internal DB errors
    if (insertError.code === '23505') {
       return NextResponse.json({ error: 'User is already in this fund' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to add member to fund' }, { status: 500 })
  }

  // Log the activity
  logActivity(admin, fundId, user.id, 'settings.member.invite', { invitedEmail: email })

  return NextResponse.json({ success: true, inviteLink: null })
}
