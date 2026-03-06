import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createProviderFromKey } from '@/lib/ai'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `test-gemini:${user.id}`, limit: 5, windowSeconds: 300 })
  if (limited) return limited

  const { apiKey } = await req.json()
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'API key is required' }, { status: 400 })
  }

  try {
    const provider = createProviderFromKey(apiKey, 'gemini')
    await provider.testConnection()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid API key'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
