-- The sign-in screens' logo and text, per fund. Both optional: no logo shows Hemrock's mark,
-- no text shows none. The screens have no session, so lib/auth-brand.ts reads these with the
-- service role; nothing here changes who can read fund_settings.
--
-- sign_in_logo  a data:image/ URL, like funds.logo_url (under 200KB, checked in the API)
-- sign_in_title the line under the logo, plain text

alter table public.fund_settings
  add column if not exists sign_in_logo text,
  add column if not exists sign_in_title text;
