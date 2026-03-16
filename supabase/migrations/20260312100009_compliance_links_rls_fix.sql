-- Fix: compliance_links RLS policy was missing "to service_role" scope,
-- meaning any authenticated user could read/write all funds' links.
-- Drop the overly permissive policy and replace with proper scoping.

drop policy if exists "compliance_links_service" on compliance_links;

-- Service role (used by API routes) gets full access
create policy "compliance_links_service" on compliance_links
  for all to service_role using (true) with check (true);

-- Defense-in-depth: authenticated user policies enforce fund isolation
create policy "Fund members can read compliance links"
  on compliance_links for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert compliance links"
  on compliance_links for insert to authenticated
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update compliance links"
  on compliance_links for update to authenticated
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete compliance links"
  on compliance_links for delete to authenticated
  using (public.is_fund_writer(fund_id));
