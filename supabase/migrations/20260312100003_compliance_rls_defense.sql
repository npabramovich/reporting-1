-- Defense-in-depth RLS for compliance tables.
-- The API routes use the admin (service_role) client, which bypasses RLS.
-- These authenticated-user policies provide a safety net if an API route
-- ever has a fund-scoping bug — the database itself enforces fund isolation.

-- ============================================================
-- fund_compliance_profile
-- ============================================================
create policy "Fund members can read compliance profile"
  on fund_compliance_profile for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert compliance profile"
  on fund_compliance_profile for insert to authenticated
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update compliance profile"
  on fund_compliance_profile for update to authenticated
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- compliance_fund_settings
-- ============================================================
create policy "Fund members can read compliance settings"
  on compliance_fund_settings for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert compliance settings"
  on compliance_fund_settings for insert to authenticated
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update compliance settings"
  on compliance_fund_settings for update to authenticated
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete compliance settings"
  on compliance_fund_settings for delete to authenticated
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- compliance_deadlines
-- ============================================================
create policy "Fund members can read compliance deadlines"
  on compliance_deadlines for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert compliance deadlines"
  on compliance_deadlines for insert to authenticated
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update compliance deadlines"
  on compliance_deadlines for update to authenticated
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete compliance deadlines"
  on compliance_deadlines for delete to authenticated
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- compliance_workflows (no fund_id — scoped via deadline_id → compliance_deadlines.fund_id)
-- ============================================================
create policy "Fund members can read compliance workflows"
  on compliance_workflows for select to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and d.fund_id = any(public.get_my_fund_ids())
  ));

create policy "Fund writers can insert compliance workflows"
  on compliance_workflows for insert to authenticated
  with check (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

create policy "Fund writers can update compliance workflows"
  on compliance_workflows for update to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

create policy "Fund writers can delete compliance workflows"
  on compliance_workflows for delete to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

-- ============================================================
-- compliance_filings
-- ============================================================
create policy "Fund members can read compliance filings"
  on compliance_filings for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert compliance filings"
  on compliance_filings for insert to authenticated
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update compliance filings"
  on compliance_filings for update to authenticated
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete compliance filings"
  on compliance_filings for delete to authenticated
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- compliance_entry_data (no fund_id — scoped via deadline_id → compliance_deadlines.fund_id)
-- ============================================================
create policy "Fund members can read compliance entry data"
  on compliance_entry_data for select to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and d.fund_id = any(public.get_my_fund_ids())
  ));

create policy "Fund writers can insert compliance entry data"
  on compliance_entry_data for insert to authenticated
  with check (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

create policy "Fund writers can update compliance entry data"
  on compliance_entry_data for update to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

create policy "Fund writers can delete compliance entry data"
  on compliance_entry_data for delete to authenticated
  using (exists (
    select 1 from compliance_deadlines d
    where d.id = deadline_id and public.is_fund_writer(d.fund_id)
  ));

-- ============================================================
-- compliance_items (reference data — already has authenticated SELECT)
-- Add service_role write policy so seed data can be managed
-- ============================================================
create policy "compliance_items_service" on compliance_items for all to service_role using (true);
