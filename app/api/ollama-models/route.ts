import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { OpenAIProvider } from '@/lib/ai/openai'
import { getOllamaConfig } from '@/lib/pipeline/processEmail'
import { rateLimit } from '@/lib/rate-limit'
import { validateOllamaUrl } from '@/lib/validate-url'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `ollama-models:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  try {
    const config = await getOllamaConfig(admin, membership.fund_id)
    const validation = validateOllamaUrl(config.baseUrl)
    if (!validation.ok) {
      return NextResponse.json({ models: [], error: validation.error })
    }
    const provider = new OpenAIProvider('ollama', validation.url)
    const models = await provider.listModels()
    return NextResponse.json({ models })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ models: [], error: message })
  }
}
