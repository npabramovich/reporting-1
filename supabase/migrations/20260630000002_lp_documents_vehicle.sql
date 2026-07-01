-- Records that an investor-scoped LP document was shared with the members of a
-- specific investment vehicle (lp_investments.portfolio_group) at upload time.
--
-- Access is still enforced by lp_document_shares — one row per resolved investor
-- is written when the document is uploaded — so this column is display/audit
-- metadata only and needs no grant or RLS changes (a vehicle document is just an
-- investor-scoped document whose recipient set was derived from a vehicle).
alter table public.lp_documents add column if not exists vehicle text;

comment on column public.lp_documents.vehicle is
  'When set, this investor-scoped document was shared with the investors in this investment vehicle (portfolio_group) at upload time. Access is enforced via lp_document_shares.';
