-- LP documents (gap 2): files an admin uploads for LPs (fund financials,
-- capital-account statements, …), surfaced in the LP portal. Two scopes:
--   'fund'     → visible to every LP of the fund (e.g. fund financials)
--   'investor' → visible only to the investors listed in lp_document_shares
-- Served through admin-client portal APIs (signed URLs), scoped by
-- resolveLpAccess and gated by lp_portal_enabled, like snapshots/letters.

create table public.lp_documents (
  id           uuid        primary key default gen_random_uuid(),
  fund_id      uuid        not null references funds(id) on delete cascade,
  title        text        not null,
  file_name    text        not null,
  storage_path text        not null,
  mime_type    text,
  size_bytes   bigint,
  scope        text        not null default 'fund' check (scope in ('fund', 'investor')),
  uploaded_by  uuid        references auth.users(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);
create index lp_documents_fund_idx on public.lp_documents (fund_id);

grant select on public.lp_documents to authenticated;
grant select, insert, update, delete on public.lp_documents to service_role;
alter table public.lp_documents enable row level security;

create policy lp_documents_member_read on public.lp_documents
  for select to authenticated
  using (fund_id in (select fund_id from fund_members where user_id = auth.uid()));
create policy lp_documents_admin_all on public.lp_documents
  for all to authenticated
  using (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'))
  with check (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'));

-- Per-investor assignment for scope='investor' documents.
create table public.lp_document_shares (
  id             uuid        primary key default gen_random_uuid(),
  document_id    uuid        not null references lp_documents(id) on delete cascade,
  lp_investor_id uuid        not null references lp_investors(id) on delete cascade,
  fund_id        uuid        not null references funds(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (document_id, lp_investor_id)
);
create index lp_document_shares_doc_idx on public.lp_document_shares (document_id);
create index lp_document_shares_investor_idx on public.lp_document_shares (lp_investor_id);

grant select on public.lp_document_shares to authenticated;
grant select, insert, update, delete on public.lp_document_shares to service_role;
alter table public.lp_document_shares enable row level security;

create policy lp_document_shares_admin on public.lp_document_shares
  for all to authenticated
  using (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'))
  with check (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'));
create policy lp_document_shares_lp_read on public.lp_document_shares
  for select to authenticated
  using (lp_investor_id = any(public.get_my_lp_investor_ids()));

-- LP read on lp_documents (added after lp_document_shares exists): fund-wide docs
-- for funds the LP belongs to, plus investor-scoped docs shared with them.
create policy lp_documents_lp_read on public.lp_documents
  for select to authenticated
  using (
    (scope = 'fund' and fund_id in (
      select i.fund_id from lp_investors i where i.id = any(public.get_my_lp_investor_ids())
    ))
    or id in (select document_id from lp_document_shares where lp_investor_id = any(public.get_my_lp_investor_ids()))
  );

-- Private storage bucket. The app reads/writes via the service-role admin client
-- and signed URLs, so service_role access is what matters; these policies mirror
-- the company-documents pattern for defense in depth (admins write, members read).
insert into storage.buckets (id, name, public) values ('lp-documents', 'lp-documents', false)
  on conflict (id) do nothing;

create policy "Fund admins upload lp-documents"
  on storage.objects for insert
  with check (bucket_id = 'lp-documents' and auth.uid() in (
    select user_id from fund_members where fund_id = (storage.foldername(name))[1]::uuid and role = 'admin'));
create policy "Fund members read lp-documents"
  on storage.objects for select
  using (bucket_id = 'lp-documents' and auth.uid() in (
    select user_id from fund_members where fund_id = (storage.foldername(name))[1]::uuid));
create policy "Fund admins delete lp-documents"
  on storage.objects for delete
  using (bucket_id = 'lp-documents' and auth.uid() in (
    select user_id from fund_members where fund_id = (storage.foldername(name))[1]::uuid and role = 'admin'));
