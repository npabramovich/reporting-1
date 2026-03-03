-- Per-note read receipts
CREATE TABLE note_reads (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id  uuid NOT NULL REFERENCES company_notes(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_id)
);
ALTER TABLE note_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reads" ON note_reads FOR ALL USING (user_id = auth.uid());
CREATE INDEX idx_note_reads_user ON note_reads(user_id);

-- Per-user notification preferences
CREATE TABLE note_notification_preferences (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fund_id    uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  level      text NOT NULL DEFAULT 'mentions' CHECK (level IN ('all', 'mentions', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, fund_id)
);
ALTER TABLE note_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prefs" ON note_notification_preferences FOR ALL USING (user_id = auth.uid());

-- Per-company subscription overrides
CREATE TABLE note_company_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fund_id    uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id)
);
ALTER TABLE note_company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subs" ON note_company_subscriptions FOR ALL USING (user_id = auth.uid());

-- Denormalized mention tracking on notes
ALTER TABLE company_notes ADD COLUMN mentioned_user_ids uuid[] DEFAULT '{}';
CREATE INDEX idx_company_notes_mentions ON company_notes USING gin(mentioned_user_ids);

-- Efficient unread count RPC for sidebar badge
CREATE OR REPLACE FUNCTION count_unread_notes(p_user_id uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT count(*)
  FROM company_notes cn
  WHERE cn.fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = p_user_id)
    AND cn.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM note_reads nr WHERE nr.note_id = cn.id AND nr.user_id = p_user_id
    );
$$;
