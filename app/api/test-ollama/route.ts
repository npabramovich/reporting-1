import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { OpenAIProvider } from '@/lib/ai/openai'
import { rateLimit } from '@/lib/rate-limit'
import { validateOllamaUrl } from '@/lib/validate-url'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `test-ollama:${user.id}`, limit: 5, windowSeconds: 300 })
  if (limited) return limited

  const { baseUrl } = await req.json()
  const raw = baseUrl?.trim() || 'http://localhost:11434/v1'

  const validation = validateOllamaUrl(raw)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  try {
    const provider = new OpenAIProvider('ollama', validation.url)
    await provider.testConnection()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cannot connect to Ollama'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
