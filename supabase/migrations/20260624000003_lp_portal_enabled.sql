-- Global per-fund switch for the LP portal (Phase 2 admin control).
--
-- When false (the default), shared snapshots are NOT visible to LPs and the LP
-- portal is effectively off for the fund — sharing only goes live once an admin
-- turns this on under Settings → LP Portal. Enforced in the portal data APIs
-- (snapshots for a disabled fund are filtered out).
alter table fund_settings
  add column if not exists lp_portal_enabled boolean not null default false;
