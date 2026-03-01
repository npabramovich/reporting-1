CREATE TABLE fund_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fund_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can manage fund notes"
  ON fund_notes FOR ALL
  USING (fund_id = ANY(public.get_my_fund_ids()));

CREATE INDEX idx_fund_notes_fund ON fund_notes(fund_id, created_at DESC);
