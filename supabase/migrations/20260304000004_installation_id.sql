-- Add installation_id to app_settings for unique deployment identification
ALTER TABLE app_settings
  ADD COLUMN installation_id uuid NOT NULL DEFAULT gen_random_uuid();
