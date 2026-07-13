-- Inbound email → diligence routing (propose, then accept)
--
-- The inbound classifier currently picks one of four destinations:
--   reporting | interactions | deals | other
--
-- 'deals' means "a company is pitching us" — it creates an `inbound_deals` row
-- (screening/dealflow). That is NOT the same as "this email is about a company
-- we ALREADY have in diligence", which belongs in that deal's data room.
--
-- This migration widens the routing vocabulary with a fifth label, 'diligence'.
--
-- IMPORTANT — matching does not import. A matched email is *proposed*, never
-- silently copied into the shared data room: an inbound mailbox is a firehose,
-- and a wrong match would put a stranger's attachment in front of the memo agent
-- as evidence. The router therefore parks the email as a pending proposal and a
-- human accepts it (choosing the deal and which attachments to take). Acceptance
-- is what writes to `diligence_documents`.

alter table inbound_emails
  drop constraint if exists inbound_emails_routed_to_check;

alter table inbound_emails
  add constraint inbound_emails_routed_to_check
  check (routed_to is null or routed_to in (
    'reporting', 'interactions', 'deals', 'diligence', 'audit', 'review'
  ));

alter table inbound_emails
  drop constraint if exists inbound_emails_routing_label_check;

alter table inbound_emails
  add constraint inbound_emails_routing_label_check
  check (routing_label is null or routing_label in (
    'reporting', 'interactions', 'deals', 'diligence', 'other'
  ));

alter table inbound_emails
  drop constraint if exists inbound_emails_routing_secondary_label_check;

alter table inbound_emails
  add constraint inbound_emails_routing_secondary_label_check
  check (routing_secondary_label is null or routing_secondary_label in (
    'reporting', 'interactions', 'deals', 'diligence', 'other'
  ));

-- The deal the router matched (its best guess). Advisory until accepted — the
-- reviewer can override it with any active deal at accept time.
alter table inbound_emails
  add column if not exists diligence_deal_id uuid references diligence_deals(id) on delete set null;

-- Lifecycle of the proposal. null = never routed to diligence.
--   pending  — matched, waiting on a human
--   accepted — imported into the data room (documents carry source_email_id)
--   rejected — dismissed; never offered again
alter table inbound_emails
  add column if not exists diligence_intake_status text;

alter table inbound_emails
  drop constraint if exists inbound_emails_diligence_intake_status_check;

alter table inbound_emails
  add constraint inbound_emails_diligence_intake_status_check
  check (diligence_intake_status is null or diligence_intake_status in (
    'pending', 'accepted', 'rejected'
  ));

alter table inbound_emails
  add column if not exists diligence_accepted_at timestamptz,
  add column if not exists diligence_accepted_by uuid references auth.users(id);

create index if not exists inbound_emails_diligence_deal_idx
  on inbound_emails (diligence_deal_id)
  where diligence_deal_id is not null;

-- Drives the "N emails waiting to be accepted" badge on the deal room.
create index if not exists inbound_emails_diligence_pending_idx
  on inbound_emails (fund_id, diligence_intake_status)
  where diligence_intake_status = 'pending';

-- ---------------------------------------------------------------------------
-- parsing_reviews — the pending proposal shows up in the existing review queue
-- ---------------------------------------------------------------------------
--
-- issue_type is constrained (20260507000000_deals_phase1.sql:200). Widen it so
-- a matched-but-unaccepted diligence email can be queued like any other item
-- needing a human. Reusing parsing_reviews means the existing /emails review UI,
-- dismissal, and reroute paths work on these for free.

alter table parsing_reviews
  drop constraint if exists parsing_reviews_issue_type_check;

alter table parsing_reviews
  add constraint parsing_reviews_issue_type_check
  check (issue_type in (
    'new_company_detected',
    'low_confidence',
    'ambiguous_period',
    'metric_not_found',
    'company_not_identified',
    'duplicate_period',
    'deal_extraction',
    'routing_low_confidence',
    'multi_company_email',
    -- Matched to a diligence deal; awaiting a human's accept-into-data-room.
    'diligence_intake_pending'
  ));
