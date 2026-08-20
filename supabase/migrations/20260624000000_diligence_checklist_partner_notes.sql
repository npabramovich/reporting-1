-- Partner-authored notes/facts on a checklist item.
--
-- Lets a partner record something they know that isn't in the data room (e.g.
-- a personal reference on a founder) directly on the relevant checklist item.
-- Kept separate from agent_notes so it SURVIVES re-analysis — the data-room
-- analysis only ever writes status / evidence / agent_notes, never this column.
--
-- New column on an existing table: the table's existing Data API grants and RLS
-- policies (see 20260607000000_diligence_checklist.sql) cover it automatically;
-- no new grants required.
alter table public.diligence_checklist_items
  add column if not exists partner_notes text;
