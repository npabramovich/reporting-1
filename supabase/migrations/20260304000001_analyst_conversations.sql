-- Persistent AI analyst conversations
CREATE TABLE analyst_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = portfolio-wide
  title         text NOT NULL DEFAULT 'New conversation',
  messages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary       text,  -- auto-generated summary for memory injection
  message_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_analyst_conv_user_company ON analyst_conversations (user_id, company_id, updated_at DESC);
CREATE INDEX idx_analyst_conv_fund ON analyst_conversations (fund_id, updated_at DESC);

ALTER TABLE analyst_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fund members manage analyst conversations"
  ON analyst_conversations FOR ALL
  USING (fund_id = ANY(public.get_my_fund_ids()));
