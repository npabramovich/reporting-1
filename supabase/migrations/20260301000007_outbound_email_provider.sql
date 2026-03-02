-- Allow funds to choose an outbound email provider for notifications.
-- Options: 'resend', 'postmark', 'gmail' (or null = disabled).
alter table fund_settings
  add column outbound_email_provider text check (outbound_email_provider in ('resend', 'postmark', 'gmail')),
  add column resend_api_key_encrypted text,
  add column postmark_server_token_encrypted text;
