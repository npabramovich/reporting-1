-- LP Letter Templates
CREATE TABLE lp_letter_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id         uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default',
  style_guide     text,
  source_filename text,
  source_type     text CHECK (source_type IN ('upload', 'google_doc', 'default')),
  source_format   text CHECK (source_format IN ('docx', 'pdf', 'google_doc')),
  source_text     text,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE lp_letter_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read templates"
  ON lp_letter_templates FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage templates"
  ON lp_letter_templates FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));

-- LP Letters
CREATE TABLE lp_letters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id               uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES lp_letter_templates(id) ON DELETE SET NULL,
  period_year           int NOT NULL,
  period_quarter        int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  is_year_end           boolean NOT NULL DEFAULT false,
  period_label          text NOT NULL,
  portfolio_group       text NOT NULL,
  portfolio_table_html  text,
  company_narratives    jsonb DEFAULT '[]'::jsonb,
  full_draft            text,
  generation_prompt     text,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('generating', 'draft', 'final')),
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE lp_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read letters"
  ON lp_letters FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund members can manage letters"
  ON lp_letters FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
