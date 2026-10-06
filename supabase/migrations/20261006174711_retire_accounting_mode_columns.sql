-- Run after the unified application has been deployed. No economic records are changed.
-- The preceding migration is additive and can be applied before deployment.
alter table public.vehicle_accounting_settings drop column if exists capital_source;
alter table public.vehicle_accounting_settings drop column if exists history_mode;
