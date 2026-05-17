import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleCredentials } from '@/lib/google/credentials'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const creds = await getGoogleCredentials(admin, membership.fund_id)
  if (!creds) {
    return NextResponse.json({
      error: 'Google OAuth not configured. Add your Google Client ID and Client Secret in Settings.',
    }, { status: 400 })
  }

  // Build the redirect URI. Google's OAuth requires HTTPS in production; if
  // NEXT_PUBLIC_APP_URL was misconfigured as http://, upgrade it. Trailing
  // slashes are stripped so the redirect URI matches what's registered.
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  baseUrl = baseUrl.replace(/\/$/, '')
  if (baseUrl.startsWith('http://') && !baseUrl.startsWith('http://localhost')) {
    baseUrl = baseUrl.replace(/^http:\/\//, 'https://')
  }
  const redirectUri = `${baseUrl}/api/auth/google/callback`

  // Pass return_to in state so callback knows where to redirect
  const returnTo = req.nextUrl.searchParams.get('return_to') || '/settings'
  const state = Buffer.from(JSON.stringify({
    fund_id: membership.fund_id,
    return_to: returnTo,
  })).toString('base64url')

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // drive.readonly lets the app read any file the user can access in Drive
    // — required for "import a folder by URL" to read the contents of files
    // the user didn't explicitly pick via Google Picker. drive.file alone
    // returns 403 on direct API calls to files the app didn't create.
    // drive.file is also kept so files uploaded TO Drive by the app (e.g.
    // rendered memo Google Docs) stay tracked as app-owned.
    // gmail.send permits outbound email send for asks/letters.
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    // `consent` forces the consent screen so refresh tokens are re-issued
    // even if the user previously authorized. `select_account` forces the
    // account picker first, useful when the browser has multiple Google
    // sessions and the default isn't the one that should own the connection.
    prompt: 'consent select_account',
    state,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
