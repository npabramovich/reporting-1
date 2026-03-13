-- Compliance links: user-managed links to filing portals, accounts, and resources
create table if not exists compliance_links (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  compliance_item_id text references compliance_items(id) on delete set null,
  title text not null,
  description text,
  url text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_compliance_links_fund on compliance_links(fund_id);

alter table compliance_links enable row level security;

create policy "compliance_links_service" on compliance_links
  for all using (true) with check (true);
