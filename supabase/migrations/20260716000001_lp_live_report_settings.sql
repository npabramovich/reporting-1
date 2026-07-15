-- Fund-level LP report header + footer, for the LIVE LP report and its report cards.
--
-- A snapshot stored its own `description` (header paragraph) and `footer_note` on the
-- snapshot row — fine when the snapshot WAS the report. The live report has no snapshot, so
-- the header and footer it prints with belong to the fund: set them once, and every live
-- report card uses them until changed.

alter table public.fund_settings
  add column if not exists lp_report_description text,
  add column if not exists lp_report_footer text;

comment on column public.fund_settings.lp_report_description is
  'Header paragraph printed on LIVE LP report cards. The snapshot equivalent is lp_snapshots.description.';
comment on column public.fund_settings.lp_report_footer is
  'Footer note printed on LIVE LP report cards. The snapshot equivalent is lp_snapshots.footer_note.';
