-- Persist the Drive folder URL associated with a diligence deal. Captured at
-- deal creation when the user provides one in the New Deal dialog; surfaced
-- on the Data Room tab so a failed initial import can be retried without the
-- user having to re-find and re-paste the URL.

alter table diligence_deals
  add column if not exists drive_folder_url text;
