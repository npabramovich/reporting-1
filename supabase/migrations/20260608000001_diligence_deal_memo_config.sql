-- Per-deal memo configuration — overrides fund-level draft guidance for a
-- specific memo. Two fields:
--   1. partner_memo_guidance — free-form text appended to the fund's
--      draft-stage guidance when building the memo. Lets partners add deal-
--      specific direction ("emphasize the data privacy angle", "downplay the
--      international expansion angle") without editing fund-level settings.
--   2. memo_template_config — structured config:
--        {
--          "style_override": "pre_seed" | "seed" | "series_a" | "series_b" | "growth" | null,
--          "analyst_persona": string,                 -- e.g. "skeptical numbers-first analyst"
--          "emphasis": [string],                      -- bullet list of points to care about
--          "section_overrides": {
--            "<section_id>": { "included": boolean, "target_paragraphs": number | null }
--          }
--        }
--
-- Both feed into the draft-stage prompt builder so the model respects partner
-- intent. Schema-level: stored on diligence_deals (not draft) because the
-- config is the "how to build this memo" recipe — survives across re-drafts.

alter table diligence_deals
  add column if not exists partner_memo_guidance text not null default '',
  add column if not exists memo_template_config  jsonb not null default '{}'::jsonb;
