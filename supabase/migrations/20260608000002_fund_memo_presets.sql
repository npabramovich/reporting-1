-- Memo configuration presets, per fund. A preset captures the same shape as
-- the per-deal memo config (style override, analyst persona, emphasis list,
-- per-section include/target paragraphs) plus the free-form partner guidance,
-- so partners can save a refined config and reuse it across deals.
--
-- Optional `default_for_stage`: when set, the preset is auto-applied to new
-- deals created at that stage_at_consideration. Only one preset per stage
-- per fund can hold that role (enforced via the partial unique index below).

create table public.fund_memo_presets (
  id                      uuid        primary key default gen_random_uuid(),
  fund_id                 uuid        not null references funds(id) on delete cascade,
  name                    text        not null,
  description             text,
  partner_memo_guidance   text        not null default '',
  memo_template_config    jsonb       not null default '{}'::jsonb,
  default_for_stage       text        check (default_for_stage is null or default_for_stage in ('pre_seed','seed','series_a','series_b','growth')),
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index fund_memo_presets_fund_idx
  on public.fund_memo_presets (fund_id, created_at desc);

-- Only one preset per fund can be the default for a given stage.
create unique index fund_memo_presets_default_for_stage_idx
  on public.fund_memo_presets (fund_id, default_for_stage)
  where default_for_stage is not null;

-- Per-CLAUDE.md convention: explicit grants + RLS + policies.
grant select on public.fund_memo_presets to anon;
grant select, insert, update, delete on public.fund_memo_presets to authenticated, service_role;

alter table public.fund_memo_presets enable row level security;

create policy fund_memo_presets_select on public.fund_memo_presets
  for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy fund_memo_presets_insert on public.fund_memo_presets
  for insert to authenticated
  with check (fund_id = any(public.get_my_fund_ids()));
create policy fund_memo_presets_update on public.fund_memo_presets
  for update to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy fund_memo_presets_delete on public.fund_memo_presets
  for delete to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
