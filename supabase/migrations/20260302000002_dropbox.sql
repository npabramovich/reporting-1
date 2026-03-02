-- Add file storage provider and Dropbox columns to fund_settings
ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS file_storage_provider text,
  ADD COLUMN IF NOT EXISTS dropbox_app_key text,
  ADD COLUMN IF NOT EXISTS dropbox_app_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS dropbox_refresh_token_encrypted text,
  ADD COLUMN IF NOT EXISTS dropbox_folder_path text;

-- Backfill: set file_storage_provider = 'google_drive' where Google Drive is already connected
UPDATE fund_settings
SET file_storage_provider = 'google_drive'
WHERE google_refresh_token_encrypted IS NOT NULL
  AND file_storage_provider IS NULL;
