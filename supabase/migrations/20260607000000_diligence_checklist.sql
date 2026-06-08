-- Diligence checklist — partner-defined items the agent assesses against
-- the data room.
--
-- The "Overview" tab is being recast as a "Checklist" — partners want their
-- existing diligence checklist front-and-centre, with each item marked
-- found / partial / missing once the agent has read the data room. Items
-- can be hierarchical (section → item) via parent_id; for v1 we use two
-- levels but the schema doesn't constrain depth.
--
-- Per-fund template (fund_settings.diligence_checklist_template) holds the
-- fund's default checklist text. A new deal can be seeded from it.

create table public.diligence_checklist_items (
  id            uuid        primary key default gen_random_uuid(),
  fund_id       uuid        not null references funds(id) on delete cascade,
  deal_id       uuid        not null references diligence_deals(id) on delete cascade,
  parent_id     uuid        references diligence_checklist_items(id) on delete cascade,
  kind          text        not null default 'item'    check (kind in ('section', 'item')),
  label         text        not null,
  status        text        not null default 'unknown' check (status in ('unknown', 'found', 'partial', 'missing', 'not_applicable')),
  evidence      jsonb       not null default '[]'::jsonb,    -- array of { document_id, summary }
  agent_notes   text,                                          -- agent rationale for the status
  order_index   int         not null default 0,
  source        text        not null default 'template' check (source in ('template', 'partner_added', 'imported', 'agent_added')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index diligence_checklist_items_deal_idx
  on public.diligence_checklist_items (deal_id, parent_id nulls first, order_index);

-- Per-CLAUDE.md convention: explicit grants + RLS + policies for new tables.
grant select on public.diligence_checklist_items to anon;
grant select, insert, update, delete on public.diligence_checklist_items to authenticated, service_role;

alter table public.diligence_checklist_items enable row level security;

create policy diligence_checklist_items_select on public.diligence_checklist_items
  for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy diligence_checklist_items_insert on public.diligence_checklist_items
  for insert to authenticated
  with check (fund_id = any(public.get_my_fund_ids()));
create policy diligence_checklist_items_update on public.diligence_checklist_items
  for update to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy diligence_checklist_items_delete on public.diligence_checklist_items
  for delete to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

-- Fund-level template text. When a partner pastes or edits a checklist, this
-- is the default it's seeded from. Raw text — parsed when applied to a deal.
alter table fund_settings
  add column if not exists diligence_checklist_template text not null default '';
