-- Distinguish GP vs LP partners so accounting and reporting can treat them
-- differently — GP fee terms, carried-interest accrual to the GP, and the
-- GP/LP split in the statement of changes in partners' capital. Defaults to
-- 'lp' so every existing investor is unchanged.
alter table public.lp_entities
  add column if not exists partner_class text not null default 'lp'
    check (partner_class in ('lp', 'gp'));
