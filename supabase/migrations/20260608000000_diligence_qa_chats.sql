-- Free-form Q&A chat against a deal's evidence base.
--
-- Replaces (in UX) the structured staged Q&A flow on the Q&A tab. Partners
-- ask plain-English questions; the agent answers from the data room, research
-- output, Q&A library entries, and the diligence checklist. Each turn (user
-- and assistant) is persisted so partners can resume the conversation.

create table public.diligence_qa_chats (
  id          uuid        primary key default gen_random_uuid(),
  fund_id     uuid        not null references funds(id) on delete cascade,
  deal_id     uuid        not null references diligence_deals(id) on delete cascade,
  role        text        not null check (role in ('user', 'assistant')),
  content     text        not null,
  citations   jsonb       not null default '[]'::jsonb,    -- array of { document_id, summary }
  author_id   uuid,                                          -- partner who sent the user msg; null for assistant
  model       text,                                          -- which model produced the assistant msg, for cost auditing
  created_at  timestamptz not null default now()
);

create index diligence_qa_chats_deal_idx
  on public.diligence_qa_chats (deal_id, created_at);

-- Per-CLAUDE.md convention: explicit grants + RLS + policies.
grant select on public.diligence_qa_chats to anon;
grant select, insert, update, delete on public.diligence_qa_chats to authenticated, service_role;

alter table public.diligence_qa_chats enable row level security;

create policy diligence_qa_chats_select on public.diligence_qa_chats
  for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy diligence_qa_chats_insert on public.diligence_qa_chats
  for insert to authenticated
  with check (fund_id = any(public.get_my_fund_ids()));
create policy diligence_qa_chats_delete on public.diligence_qa_chats
  for delete to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
