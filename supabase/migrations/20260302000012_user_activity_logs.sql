create table user_activity_logs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_user_activity_logs_fund_created on user_activity_logs (fund_id, created_at desc);
alter table user_activity_logs enable row level security;
create policy "Members can view their fund's activity logs"
  on user_activity_logs for select
  using (fund_id = any(public.get_my_fund_ids()));
