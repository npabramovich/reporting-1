CREATE TABLE company_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  has_native_content BOOLEAN DEFAULT FALSE,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fund members can access company documents"
  ON company_documents FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
