import { createAdminClient } from '@/lib/supabase/admin'
import { runDraftReview } from '@/lib/memo-agent/stages/draft'
import { runScore } from '@/lib/memo-agent/stages/score'

type Admin = ReturnType<typeof createAdminClient>

interface DraftReviewJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Stage 4C + 5 — review/edit pass followed by rubric scoring.
 *
 * Auto-enqueued by the draft job. Scoring runs here (not in the draft job)
 * because it must score the *reviewed* prose, not the first draft. On
 * scoring failure the reviewed draft is kept.
 */
export async function runDraftReviewJob(admin: Admin, job: DraftReviewJob): Promise<unknown> {
  const reviewResult = await runDraftReview({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin.from('memo_agent_jobs').update({ progress_message: msg }).eq('id', job.id)
    },
  })

  if (reviewResult.draft_id && !job.draft_id) {
    await admin.from('memo_agent_jobs').update({ draft_id: reviewResult.draft_id }).eq('id', job.id)
  }

  let scoreResult: Awaited<ReturnType<typeof runScore>> | null = null
  let scoreError: string | null = null
  try {
    scoreResult = await runScore({
      admin,
      fundId: job.fund_id,
      dealId: job.deal_id,
      draftId: reviewResult.draft_id,
      progressCb: async (msg) => {
        await admin.from('memo_agent_jobs').update({ progress_message: `Scoring: ${msg}` }).eq('id', job.id)
      },
    })
  } catch (err) {
    scoreError = err instanceof Error ? err.message : String(err)
  }

  // Bump deal stage to 'render' (or 'score' if scoring failed). Only advance
  // from 'draft' — don't regress a deal that's already further along.
  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: scoreError ? 'score' : 'render' })
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .eq('current_memo_stage', 'draft')

  return {
    draft_id: reviewResult.draft_id,
    edits_applied: reviewResult.edits_applied,
    scores: scoreResult?.output.scores.length ?? 0,
    low_confidence_dimensions: scoreResult?.output.low_confidence_attention.length ?? 0,
    score_error: scoreError,
    warnings: reviewResult.warnings,
  }
}
