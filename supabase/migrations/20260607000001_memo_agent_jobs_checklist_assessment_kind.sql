-- Memo Agent — add 'checklist_assessment' to memo_agent_jobs.kind
--
-- The checklist-assessment job walks the partner-defined diligence checklist
-- against the latest data-room ingest output and stamps each item with a
-- found / partial / missing status. It is auto-enqueued after
-- ingest_synthesis when the deal has checklist rows, and is also triggerable
-- on demand from the Checklist tab.

alter table memo_agent_jobs
  drop constraint if exists memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in (
    'ingest',
    'ingest_synthesis',
    'research',
    'qa',
    'draft',
    'draft_review',
    'score',
    'render',
    'transcribe',
    'checklist_assessment'
  ));
