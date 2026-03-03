-- Allow company_documents rows without a stored file (text-only extraction)
ALTER TABLE company_documents ALTER COLUMN storage_path DROP NOT NULL;
