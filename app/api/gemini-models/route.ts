import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGeminiApiKey } from '@/lib/pipeline/processEmail'
import { createProviderFromKey } from '@/lib/ai'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `gemini-models:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  try {
    const apiKey = await getGeminiApiKey(admin, membership.fund_id)
    const provider = createProviderFromKey(apiKey, 'gemini')
    const models = await provider.listModels()
    return NextResponse.json({ models })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('not configured')) {
      return NextResponse.json({ models: [], error: 'Gemini API key not configured.' })
    }
    return NextResponse.json({ models: [], error: message })
  }
}
