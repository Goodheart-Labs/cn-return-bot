-- Waiting posts on the list move up when readers open them (GOO-793).
--
-- everything_demanded_pages (migration 183) only takes pages with no item.
-- Since cn-walk lists every known creator's posts of the last 14 days
-- (GOO-791), most pages readers open already have an item that is waiting, so
-- the rule never reaches them: a LessWrong post got 10 of its 11 readers in
-- the 21.7 hours before it was checked. everything_demanded_listed gives the
-- waiting posts that enough different readers opened in the last 7 days, and
-- cn-walk sets demanded_at on each, which ranks it like a post of a creator
-- holding priority (src/everything/demandQueue.ts).
--
-- Replayed on 2026-11-19 to 11-23, a bar of 2 readers moves up 4 text posts
-- and 23 videos a day, which 15 later readers a day then open (12 without the
-- largest page). The posts it puts back, a day or more old from creators
-- ranked under 1.5, drew 0.06 later readers each.
--
-- A post is taken once: cn-walk records it in everything_demand_queued, and
-- its demanded_at stays set.
--
-- ORDER: apply before or after the code. Without it cn-walk logs that the
-- rule is not installed and carries on.
-- UNDO: drop function everything_demanded_listed(int, int, int);

create function everything_demanded_listed(p_text_readers int, p_youtube_readers int, p_limit int default 50)
returns table (item_id uuid, page_url text, kind text, readers int)
language sql stable set search_path = public as $$
  with opened as (
    select regexp_replace(v.page_url, '/comments$', '') as page_url,
           count(distinct v.reader_hash)::int as readers
      from everything_link_visits v
     where v.visited_at > now() - interval '7 days'
       and v.reader_hash is not null
     group by 1
    having count(distinct v.reader_hash) >= least(coalesce(p_text_readers, p_youtube_readers), coalesce(p_youtube_readers, p_text_readers))
  ), waiting as (
    select i.id as item_id, o.page_url, o.readers,
           case when i.source = 'youtube' then 'youtube' else 'text' end as kind
      from everything_items i
      join opened o on o.page_url = everything_visit_page(i.url)
     where i.list_open and i.status = 'queued' and i.first_checked_at is null
       and i.demanded_at is null and not i.list_requested
       and not exists (select 1 from everything_demand_queued q where q.page_url = o.page_url)
  ), wanted as (
    select w.*, row_number() over (partition by w.kind order by w.readers desc, w.page_url) as place
      from waiting w
     where w.readers >= case w.kind when 'text' then p_text_readers else p_youtube_readers end
  )
  select w.item_id, w.page_url, w.kind, w.readers
    from wanted w
   where w.place <= p_limit
   order by w.readers desc, w.page_url;
$$;

comment on function everything_demanded_listed(int, int, int) is
  'Waiting posts on the list that at least p_text_readers (text posts) or p_youtube_readers (videos) different readers opened in the last 7 days, most readers first, at most p_limit of each kind. A null bar leaves that kind out. Posts already demanded, requested or in everything_demand_queued are left out (GOO-793).';

revoke all on function everything_demanded_listed(int, int, int) from public, anon, authenticated;
grant execute on function everything_demanded_listed(int, int, int) to service_role;

notify pgrst, 'reload schema';
