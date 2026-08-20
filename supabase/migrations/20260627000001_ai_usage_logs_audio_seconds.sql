-- Track audio duration for usage that's billed per-minute rather than per-token
-- (Deepgram transcription). Lets the per-deal and fund-wide usage reports include
-- transcription spend alongside token-based AI usage.
--
-- New column on an existing table (ai_usage_logs already carries grants + RLS),
-- so no new Data API grants are required.
alter table public.ai_usage_logs
  add column if not exists audio_seconds integer not null default 0;
