-- Server-side journal search + pagination for /funds/[id]/journal.
-- One function so filtering (date range + memo/source/date/account name/code/amount),
-- ordering, limit/offset, and the total count are computed together — sidestepping the
-- PostgREST 1000-row cap and cross-table OR. Returns { total, entries } as JSON, entries
-- most-recent-first with postings nested, matching the shape the journal view expects.

create or replace function public.journal_search(
  p_fund_id    uuid,
  p_vehicle_id uuid,
  p_start      date default null,
  p_end        date default null,
  p_query      text default null,
  p_limit      int  default 50,
  p_offset     int  default 0
) returns json
language sql
stable
as $$
  with q as (
    -- Escape LIKE wildcards in the user's query, wrap in %…%.
    select case
      when p_query is null or btrim(p_query) = '' then null
      else '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pat
  ),
  filtered as (
    select je.id, je.entry_date, je.memo, je.source_type, je.status
    from journal_entries je, q
    where je.fund_id = p_fund_id
      and je.vehicle_id is not distinct from p_vehicle_id
      and (p_start is null or je.entry_date >= p_start)
      and (p_end   is null or je.entry_date <= p_end)
      and (
        q.pat is null
        or je.memo        ilike q.pat
        or je.source_type ilike q.pat
        or je.entry_date::text ilike q.pat
        or exists (
          select 1
          from journal_postings jp
          left join chart_of_accounts coa on coa.id = jp.account_id
          where jp.journal_entry_id = je.id
            and (
              coa.name ilike q.pat
              or coa.code ilike q.pat
              or jp.amount::text ilike q.pat
            )
        )
      )
  ),
  page as (
    select * from filtered
    order by entry_date desc, id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select json_build_object(
    'total', (select count(*) from filtered),
    'entries', coalesce((
      select json_agg(
        json_build_object(
          'id', pg.id,
          'entry_date', pg.entry_date,
          'memo', pg.memo,
          'source_type', pg.source_type,
          'status', pg.status,
          'journal_postings', coalesce((
            select json_agg(json_build_object(
              'id', jp.id,
              'account_id', jp.account_id,
              'amount', jp.amount,
              'currency', jp.currency,
              'lp_entity_id', jp.lp_entity_id
            ) order by jp.id)
            from journal_postings jp
            where jp.journal_entry_id = pg.id
          ), '[]'::json)
        ) order by pg.entry_date desc, pg.id desc
      )
      from page pg
    ), '[]'::json)
  );
$$;

-- Called only via the service-role admin client; keep it off the public Data API.
revoke execute on function public.journal_search(uuid, uuid, date, date, text, int, int) from anon, authenticated, public;
grant  execute on function public.journal_search(uuid, uuid, date, date, text, int, int) to service_role;
