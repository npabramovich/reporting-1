-- Add completed state to compliance fund settings
-- Items can now be dismissed OR completed (with date and optional note/link)

alter table compliance_fund_settings
  add column if not exists completed boolean default false,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists completed_note text,
  add column if not exists completed_link text;
