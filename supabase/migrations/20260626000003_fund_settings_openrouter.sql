-- OpenRouter (and any OpenAI-compatible hosted endpoint) as a first-class AI
-- provider: encrypted API key, model id, and an overridable base URL (defaults
-- to OpenRouter). Lets funds use inexpensive open models (DeepSeek, GLM, Qwen,
-- Llama, …) through the existing OpenAI-compatible client.
--
-- New columns on an existing table (fund_settings already carries grants + RLS),
-- so no new Data API grants are required.
alter table public.fund_settings
  add column if not exists openrouter_api_key_encrypted text,
  add column if not exists openrouter_model text,
  add column if not exists openrouter_base_url text;
