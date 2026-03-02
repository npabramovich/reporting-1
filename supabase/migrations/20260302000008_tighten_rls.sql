-- Tighten RLS policies: restrict writes on sensitive tables to admin role only.
--
-- Helper function: returns true if the current user is an admin of the given fund.
-- Uses security definer to avoid RLS recursion on fund_members.
create or replace function public.is_fund_admin(check_fund_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from fund_members
    where fund_id = check_fund_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

-- =========================================================================
-- fund_settings: split the permissive FOR ALL policy into granular policies
-- =========================================================================

drop policy if exists "Fund members can manage settings" on fund_settings;

-- All members can read settings (needed for app functionality)
create policy "Fund members can read settings"
  on fund_settings for select
  using (fund_id = any(public.get_my_fund_ids()));

-- Only admins can create/update/delete settings
create policy "Fund admins can insert settings"
  on fund_settings for insert
  with check (public.is_fund_admin(fund_id));

create policy "Fund admins can update settings"
  on fund_settings for update
  using (public.is_fund_admin(fund_id));

create policy "Fund admins can delete settings"
  on fund_settings for delete
  using (public.is_fund_admin(fund_id));

-- =========================================================================
-- fund_members: restrict INSERT and DELETE to admins
-- =========================================================================

-- Drop the existing permissive policies
drop policy if exists "Fund members can invite others" on fund_members;
drop policy if exists "Fund members can remove members" on fund_members;

-- Only admins can add new members
create policy "Fund admins can invite others"
  on fund_members for insert
  with check (public.is_fund_admin(fund_id));

-- Only admins can remove members (or a member can remove themselves)
create policy "Fund admins can remove members"
  on fund_members for delete
  using (
    public.is_fund_admin(fund_id)
    or user_id = auth.uid()
  );

-- =========================================================================
-- fund_join_requests: restrict UPDATE to admins only
-- =========================================================================

drop policy if exists "Fund admins can update join requests" on fund_join_requests;

create policy "Fund admins can update join requests"
  on fund_join_requests for update
  using (public.is_fund_admin(fund_id));
