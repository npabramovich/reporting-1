import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Rate limit: 10 requests per 5 minutes per IP
  const limited = await rateLimit({ key: `demo-creds:${getClientIp(req)}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  if (process.env.NEXT_PUBLIC_ENABLE_MARKETING_SITE !== 'true' || !process.env.MARKETING_DEPLOYMENT_KEY) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD

  if (!email || !password) {
    return NextResponse.json({ error: 'Demo not configured' }, { status: 404 })
  }

  return NextResponse.json({ email, password })
}
