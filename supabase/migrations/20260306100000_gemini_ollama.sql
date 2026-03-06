ALTER TABLE fund_settings
ADD COLUMN IF NOT EXISTS gemini_api_key_encrypted text,
ADD COLUMN IF NOT EXISTS gemini_model text NOT NULL DEFAULT 'gemini-2.0-flash',
ADD COLUMN IF NOT EXISTS ollama_base_url text,
ADD COLUMN IF NOT EXISTS ollama_model text NOT NULL DEFAULT 'llama3.2';
