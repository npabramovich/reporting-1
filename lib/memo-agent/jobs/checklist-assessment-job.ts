import { createAdminClient } from '@/lib/supabase/admin'
import { runChecklistAssessment } from '@/lib/memo-agent/stages/checklist-assessment'

type Admin = ReturnType<typeof createAdminClient>

interface ChecklistAssessmentJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Worker entry point for the `checklist_assessment` kind. Walks the partner
 * checklist against the latest data-room ingest output and updates each
 * row's status + evidence in diligence_checklist_items.
 *
 * Auto-enqueued by ingest_synthesis when the deal has checklist items; can
 * also be triggered directly from the Checklist tab.
 */
export async function runChecklistAssessmentJob(admin: Admin, job: ChecklistAssessmentJob): Promise<unknown> {
  const result = await runChecklistAssessment({
    admin,
    fundId: job.fund_id,
    dealId: job.deal_id,
    draftId: job.draft_id ?? undefined,
    progressCb: async (msg) => {
      await admin
        .from('memo_agent_jobs')
        .update({ progress_message: msg } as any)
        .eq('id', job.id)
    },
  })
  return result
}
