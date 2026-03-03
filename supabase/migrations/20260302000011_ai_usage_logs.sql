-- AI usage tracking: one row per AI API call
create table ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,       -- 'anthropic' | 'openai'
  model text not null,
  feature text not null,        -- 'identify_company' | 'extract_metrics' | 'summary' | 'import' | 'import_documents'
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_ai_usage_logs_fund_created on ai_usage_logs (fund_id, created_at desc);

-- RLS
alter table ai_usage_logs enable row level security;

create policy "Members can view their fund's usage logs"
  on ai_usage_logs for select
  using (fund_id = any(public.get_my_fund_ids()));
