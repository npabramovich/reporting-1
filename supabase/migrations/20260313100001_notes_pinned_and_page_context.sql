-- Add pinned_at column for pin/unpin feature
ALTER TABLE company_notes ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

-- Add page_context column for page-level note tagging
ALTER TABLE company_notes ADD COLUMN IF NOT EXISTS page_context text;

-- Index for efficient filtering by page_context
CREATE INDEX IF NOT EXISTS idx_company_notes_page_context ON company_notes(fund_id, page_context, created_at DESC);

-- Index for pinned sorting
CREATE INDEX IF NOT EXISTS idx_company_notes_pinned ON company_notes(fund_id, pinned_at DESC NULLS LAST);
