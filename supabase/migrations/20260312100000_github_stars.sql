-- Add GitHub star count cache to app_settings
alter table app_settings
  add column if not exists github_stars integer default 0,
  add column if not exists github_stars_checked_at timestamptz;
