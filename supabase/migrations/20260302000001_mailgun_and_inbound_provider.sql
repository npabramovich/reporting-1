-- Add inbound email provider choice and Mailgun-specific columns.
-- Also expand the outbound_email_provider check to include 'mailgun'.

alter table fund_settings
  add column inbound_email_provider text check (inbound_email_provider in ('postmark', 'mailgun')),
  add column mailgun_inbound_domain text,
  add column mailgun_signing_key_encrypted text,
  add column mailgun_api_key_encrypted text,
  add column mailgun_sending_domain text;

-- Expand outbound check to include 'mailgun'
alter table fund_settings drop constraint if exists fund_settings_outbound_email_provider_check;
alter table fund_settings
  add constraint fund_settings_outbound_email_provider_check
  check (outbound_email_provider in ('resend', 'postmark', 'gmail', 'mailgun'));

-- Backfill existing Postmark users: if they have a postmark inbound address set, mark them as postmark
update fund_settings
  set inbound_email_provider = 'postmark'
  where postmark_inbound_address is not null
    and inbound_email_provider is null;
