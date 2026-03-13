-- Add Partnership Expense Allocation Review compliance item
insert into compliance_items (id, category, name, short_name, description, frequency, deadline_description, deadline_month, deadline_day, rolling_days, applicability_text, applicability_question, filing_system, filing_portal_url, regulation_url, form_instructions_url, complexity, notes, alert, sort_order) values
('partnership-expenses', 'Fund Reporting', 'Partnership Expense Allocation Review', 'Partnership Expenses', 'Quarterly review and allocation of partnership expenses across fund entities and portfolio groups. The LPA defines which expenses are borne by the fund vs. the GP, and how shared expenses are allocated among vehicles. Common fund expenses include audit, tax, legal, administration, and broken-deal costs. Proper allocation prevents LP disputes and ensures compliance with your LPA terms.', 'Quarterly', 'End of each quarter — within 30 days of quarter close', null, null, null, 'All VC funds structured as limited partnerships or LLCs with defined expense allocation provisions in their LPA.', 'Does your fund have expense allocation provisions in its LPA?', 'Internal', null, 'https://ilpa.org/ilpa-principles/', null, 'medium', 'Review the LPA''s expense provisions carefully — common areas of LP scrutiny include management company vs. fund expense allocation, broken-deal cost sharing across co-invest vehicles, and organizational expense caps. ILPA recommends detailed quarterly expense disclosure to LPs.', null, 21)
on conflict (id) do update set
  category = excluded.category,
  name = excluded.name,
  short_name = excluded.short_name,
  description = excluded.description,
  frequency = excluded.frequency,
  deadline_description = excluded.deadline_description,
  deadline_month = excluded.deadline_month,
  deadline_day = excluded.deadline_day,
  rolling_days = excluded.rolling_days,
  applicability_text = excluded.applicability_text,
  applicability_question = excluded.applicability_question,
  filing_system = excluded.filing_system,
  filing_portal_url = excluded.filing_portal_url,
  regulation_url = excluded.regulation_url,
  form_instructions_url = excluded.form_instructions_url,
  complexity = excluded.complexity,
  notes = excluded.notes,
  alert = excluded.alert,
  sort_order = excluded.sort_order,
  updated_at = now();
