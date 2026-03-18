-- Manual overrides for ask response tracking
-- Allows users to mark a company's response status for a given quarter
-- as 'yes', 'no', or 'na' (not applicable)

create table if not exists ask_response_overrides (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid references funds(id) on delete cascade not null,
  company_id uuid references companies(id) on delete cascade not null,
  quarter int not null check (quarter between 1 and 4),
  year int not null,
  status text not null check (status in ('yes', 'no', 'na')),
  set_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(fund_id, company_id, quarter, year)
);

alter table ask_response_overrides enable row level security;
create policy "ask_response_overrides_service" on ask_response_overrides for all to service_role using (true);
