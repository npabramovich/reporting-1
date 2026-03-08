-- Add per-company storage folder override columns
ALTER TABLE companies ADD COLUMN google_drive_folder_id text;
ALTER TABLE companies ADD COLUMN google_drive_folder_name text;
ALTER TABLE companies ADD COLUMN dropbox_folder_path text;
