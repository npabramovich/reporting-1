-- Diligence inbox statuses simplified to: open, ignore, done.
-- Previously: open, addressed, deferred.
--   addressed -> done
--   deferred  -> ignore
-- The 'open' default and the partial index (where status = 'open') are unaffected.

update diligence_attention_items set status = 'done'   where status = 'addressed';
update diligence_attention_items set status = 'ignore' where status = 'deferred';
