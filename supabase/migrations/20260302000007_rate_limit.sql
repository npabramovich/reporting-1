-- Lightweight rate-limiting table for serverless environments.
-- Each row represents one request in a sliding window.
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by key + time window
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_created
  ON rate_limit_entries (key, created_at);

-- Auto-cleanup: remove entries older than 1 hour (covers all window sizes)
-- Run periodically via pg_cron or Supabase scheduled function
-- For now, cleanup happens inline in the rate-limit check.

-- No RLS needed — this table is only accessed via the service role (admin client)
ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
