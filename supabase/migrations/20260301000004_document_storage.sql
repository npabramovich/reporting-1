INSERT INTO storage.buckets (id, name, public)
VALUES ('company-documents', 'company-documents', false);

CREATE POLICY "Fund members can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-documents'
    AND auth.uid() IN (
      SELECT user_id FROM fund_members
      WHERE fund_id = (storage.foldername(name))[1]::uuid
    ));

CREATE POLICY "Fund members can read documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-documents'
    AND auth.uid() IN (
      SELECT user_id FROM fund_members
      WHERE fund_id = (storage.foldername(name))[1]::uuid
    ));

CREATE POLICY "Fund members can delete documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'company-documents'
    AND auth.uid() IN (
      SELECT user_id FROM fund_members
      WHERE fund_id = (storage.foldername(name))[1]::uuid
    ));
