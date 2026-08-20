-- Per-fund branding / appearance theme (accent color, UI font, corner radius).
-- Applied app-wide via CSS-variable overrides injected in the app layout; a
-- null/absent value means the default neutral theme (no overrides).
--
-- New column on an existing table: fund_settings already carries Data API
-- grants + RLS, which cover this column; no new grants required.
alter table public.fund_settings
  add column if not exists theme jsonb;
