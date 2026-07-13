// One model of "where is this deal in the process".
//
// WHY NOT `diligence_deals.current_memo_stage`: it's a POINTER, not a completion
// record. It only moves forward, and it lies — the ingest route sets it to
// `research` the moment ingestion is enqueued, long before research has run. So a
// "what's done" view built on it would show stages complete that never happened.
//
// Completion is instead derived from artefacts that only exist if the work actually
// finished: the draft's output columns, the checklist's assessed statuses, the
// documents' parse_status. Those can't lie.

export type StageKey = 'data_room' | 'checklist' | 'research' | 'qa' | 'memo' | 'scoring'
export type StageState = 'done' | 'running' | 'failed' | 'blocked' | 'todo'

export interface StageInfo {
  key: StageKey
  label: string
  state: StageState
  /** Which tab the work lives on. */
  tab: string
  /** The agent endpoint that runs it, if it can be triggered directly. */
  action: string | null
  actionLabel: string
  /** Why it's blocked, or what it does. */
  hint: string
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export const CHECKLIST_STATUSES = ['found', 'partial', 'missing', 'unknown', 'not_applicable'] as const
export type ChecklistStatus = typeof CHECKLIST_STATUSES[number]

export const CHECKLIST_LABEL: Record<ChecklistStatus, string> = {
  found: 'Found',
  partial: 'Partial',
  missing: 'Missing',
  unknown: 'Not assessed',
  not_applicable: 'N/A',
}

/** Tailwind fill classes. One palette across every bar so a colour means one thing. */
export const CHECKLIST_COLOR: Record<ChecklistStatus, string> = {
  found: 'bg-emerald-500',
  partial: 'bg-amber-500',
  missing: 'bg-red-500',
  unknown: 'bg-muted-foreground/25',
  not_applicable: 'bg-muted-foreground/10',
}

// ---------------------------------------------------------------------------
// Data room
// ---------------------------------------------------------------------------

export type DocBucket = 'processed' | 'partial' | 'failed' | 'pending' | 'skipped'

export const DOC_LABEL: Record<DocBucket, string> = {
  processed: 'Processed',
  partial: 'Partially parsed',
  failed: 'Failed',
  pending: 'Not processed',
  skipped: 'Skipped',
}

export const DOC_COLOR: Record<DocBucket, string> = {
  processed: 'bg-emerald-500',
  partial: 'bg-amber-500',
  failed: 'bg-red-500',
  pending: 'bg-muted-foreground/25',
  skipped: 'bg-muted-foreground/10',
}

/** `parse_status` is free text with no CHECK constraint, so map defensively. */
export function docBucket(parseStatus: string | null | undefined): DocBucket {
  switch (parseStatus) {
    case 'parsed':
    case 'transcribed':
      return 'processed'
    case 'partial':
      return 'partial'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    default:
      return 'pending'
  }
}

export interface Counts<K extends string> {
  counts: Record<K, number>
  total: number
}

export function countChecklist(items: { status: string | null }[]): Counts<ChecklistStatus> {
  const counts = Object.fromEntries(CHECKLIST_STATUSES.map(s => [s, 0])) as Record<ChecklistStatus, number>
  for (const i of items) {
    const s = (CHECKLIST_STATUSES as readonly string[]).includes(i.status ?? '')
      ? (i.status as ChecklistStatus)
      : 'unknown'
    counts[s]++
  }
  return { counts, total: items.length }
}

export function countDocuments(docs: { parse_status: string | null }[]): Counts<DocBucket> {
  const counts: Record<DocBucket, number> = { processed: 0, partial: 0, failed: 0, pending: 0, skipped: 0 }
  for (const d of docs) counts[docBucket(d.parse_status)]++
  return { counts, total: docs.length }
}

/** Items the agent has actually reached a view on — the signal that assessment ran. */
export function assessedCount(counts: Record<ChecklistStatus, number>): number {
  return counts.found + counts.partial + counts.missing + counts.not_applicable
}

// ---------------------------------------------------------------------------
// The master stage bar
// ---------------------------------------------------------------------------

export interface ProgressInput {
  hasIngestion: boolean
  hasResearch: boolean
  hasQa: boolean
  hasMemoDraft: boolean
  hasScores: boolean
  finalized: boolean
  documentCount: number
  checklistAssessed: number
  checklistTotal: number
  /** The in-flight job, if any. */
  runningKind: string | null
  failedKind: string | null
}

/** Which stage a job kind belongs to. Several kinds roll up to one stage. */
const KIND_TO_STAGE: Record<string, StageKey> = {
  ingest: 'data_room',
  ingest_synthesis: 'data_room',
  transcribe: 'data_room',
  checklist_assessment: 'checklist',
  research: 'research',
  qa: 'qa',
  draft: 'memo',
  draft_review: 'memo',
  render: 'memo',
  score: 'scoring',
}

export function buildStages(p: ProgressInput): StageInfo[] {
  const running = p.runningKind ? KIND_TO_STAGE[p.runningKind] ?? null : null
  const failed = p.failedKind ? KIND_TO_STAGE[p.failedKind] ?? null : null

  const state = (key: StageKey, done: boolean, blocked: boolean, blockedHint: string, hint: string): StageInfo => {
    let st: StageState = 'todo'
    if (running === key) st = 'running'
    else if (done) st = 'done'
    else if (failed === key) st = 'failed'
    else if (blocked) st = 'blocked'
    return { key, label: '', state: st, tab: '', action: null, actionLabel: '', hint: st === 'blocked' ? blockedHint : hint }
  }

  const dataRoom = {
    ...state('data_room', p.hasIngestion, p.documentCount === 0, 'Upload documents first', 'Read every document and extract the evidence base'),
    label: 'Data room',
    tab: 'Data Room',
    action: 'ingest',
    actionLabel: p.hasIngestion ? 'Re-analyze data room' : 'Analyze data room',
  }

  const checklist = {
    ...state('checklist', p.checklistTotal > 0 && p.checklistAssessed === p.checklistTotal, !p.hasIngestion, 'Analyze the data room first', 'Judge each checklist item against the evidence'),
    label: 'Checklist',
    tab: 'Checklist',
    action: 'checklist-assessment',
    actionLabel: p.checklistAssessed > 0 ? 'Re-assess checklist' : 'Assess checklist',
  }

  const research = {
    ...state('research', p.hasResearch, !p.hasIngestion, 'Analyze the data room first', 'Search outside the data room — market, competitors, team'),
    label: 'Research',
    tab: 'Diligence',
    action: 'research',
    actionLabel: p.hasResearch ? 'Re-run research' : 'Run research',
  }

  const qa = {
    ...state('qa', p.hasQa, !p.hasIngestion, 'Analyze the data room first', 'Answer the open diligence questions from the evidence'),
    label: 'Q&A',
    tab: 'Diligence',
    action: 'qa',
    actionLabel: p.hasQa ? 'Re-run Q&A' : 'Run Q&A',
  }

  const memo = {
    ...state('memo', p.hasMemoDraft, !p.hasIngestion, 'Analyze the data room first', 'Assemble the investment memo from everything gathered'),
    label: 'Memo',
    tab: 'Memo',
    action: 'draft',
    actionLabel: p.hasMemoDraft ? 'Re-draft memo' : 'Draft memo',
  }

  const scoring = {
    ...state('scoring', p.hasScores, !p.hasMemoDraft, 'Draft the memo first', 'Score the deal against the fund’s criteria'),
    label: 'Scoring',
    tab: 'Scoring',
    action: 'score',
    actionLabel: p.hasScores ? 'Re-run scoring' : 'Run scoring',
  }

  // Pipeline order — the order the agent actually chains them in.
  return [dataRoom, checklist, research, qa, memo, scoring]
}

/** How far through the pipeline, for the headline "3 of 6". */
export function stageProgress(stages: StageInfo[]): { done: number; total: number } {
  return { done: stages.filter(s => s.state === 'done').length, total: stages.length }
}
