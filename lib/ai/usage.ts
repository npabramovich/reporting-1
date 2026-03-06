import type { TokenUsage } from './types'

type SupabaseAdmin = { from: (table: string) => any }

export async function logAIUsage(admin: SupabaseAdmin, params: {
  fundId: string
  userId?: string
  provider: string
  model: string
  feature: string
  usage: TokenUsage
}) {
  try {
    await admin.from('ai_usage_logs').insert({
      fund_id: params.fundId,
      user_id: params.userId ?? null,
      provider: params.provider,
      model: params.model,
      feature: params.feature,
      input_tokens: params.usage.inputTokens,
      output_tokens: params.usage.outputTokens,
    })
  } catch (err) {
    console.error('[ai-usage] Failed to log usage:', err)
  }
}
