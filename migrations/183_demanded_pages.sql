-- Pages readers open get queued for notes (GOO-793).
--
-- Until now a visit only fed its creator's score, and the walk then took that
-- creator's newest and top posts. A page several readers opened that is not
-- among those was never checked unless someone pressed "request notes". The
-- feed run now asks everything_demanded_pages for such pages and queues them
-- at the prioritized tier: behind reader requests, ahead of the backlog walk
-- (src/everything/demandQueue.ts).
--
-- A page counts once it has no item and enough different reader hashes over
-- the last 7 days. A text page is a Substack post or a LessWrong, Alignment
-- Forum or EA Forum post; a Substack post's /comments page counts as the post.
-- A shortform page is a container of many short posts, so it never counts.
-- There is no rule on the post's age: a visit row does not carry it, and of
-- the pages that crossed the bar from 11-05 to 11-15, those first opened more
-- than 14 days earlier drew as many later readers as the fresh ones.
--
-- everything_demand_queued keeps every page the rule took, so a page is taken
-- once, whatever became of its item. It also carries the numbers for tuning
-- the bar and the daily caps (everything_demand_report).
--
-- The row is written before the item, so a page the log cannot record is
-- never queued and the daily cap always holds.
--
-- ORDER: apply before or after the code. Without it the feed run logs that the
-- rule is not installed and carries on.
-- UNDO: drop function everything_demand_report(); drop function
-- everything_demanded_pages(int, int, int); drop table everything_demand_queued;

create table everything_demand_queued (
  page_url text primary key,
  kind text not null check (kind in ('text', 'youtube')),
  readers int not null,
  -- False for a page that turned out to have an item under another spelling
  -- of its address. Such a row only stops the page from being looked at again.
  queued boolean not null default true,
  queued_at timestamptz not null default now()
);

comment on table everything_demand_queued is
  'Every page the feed run queued because enough readers opened it (everything_demanded_pages, GOO-793). One row per page for good, so a page is never queued twice by this rule.';

alter table everything_demand_queued enable row level security;
revoke all on everything_demand_queued from anon, authenticated;
grant select, insert on everything_demand_queued to service_role;

create function everything_demanded_pages(p_text_readers int, p_youtube_readers int, p_limit int default 50)
returns table (page_url text, feed_url text, kind text, readers int)
language sql stable set search_path = public as $$
  with pages as (
    select regexp_replace(v.page_url, '/comments$', '') as page_url,
           mode() within group (order by v.feed_url) as feed_url,
           count(distinct v.reader_hash)::int as readers
      from everything_link_visits v
     where v.visited_at > now() - interval '7 days'
       and v.reader_hash is not null
     group by 1
  ), kinds as (
    select p.*,
           case
             when p.page_url like 'https://www.youtube.com/watch?v=%' then 'youtube'
             when p.page_url ~* 'shortform$' then null
             when p.page_url ~* '^https?://[^/]+/p/[^/]+$' then 'text'
             when p.page_url ~* '^https?://(www\.)?(lesswrong\.com|alignmentforum\.org|forum\.effectivealtruism\.org)/posts/[^/]+/[^/]+$' then 'text'
           end as kind
      from pages p
  ), wanted as (
    select k.*, row_number() over (partition by k.kind order by k.readers desc, k.page_url) as place
      from kinds k
     where k.readers >= case k.kind when 'text' then p_text_readers when 'youtube' then p_youtube_readers end
       and not exists (select 1 from everything_demand_queued q where q.page_url = k.page_url)
       and not exists (select 1 from everything_items i where everything_visit_page(i.url) = k.page_url)
  )
  select w.page_url, w.feed_url, w.kind, w.readers
    from wanted w
   where w.place <= p_limit
   order by w.readers desc, w.page_url;
$$;

comment on function everything_demanded_pages(int, int, int) is
  'Pages without an item that at least p_text_readers (text posts) or p_youtube_readers (videos) different readers opened in the last 7 days, most readers first, at most p_limit of each kind, each with the feed most of its visits named. A null bar leaves that kind out. Pages in everything_demand_queued are left out (GOO-793).';

revoke all on function everything_demanded_pages(int, int, int) from public, anon, authenticated;
grant execute on function everything_demanded_pages(int, int, int) to service_role;

-- Per kind: how many pages the rule queued in the last 24 hours (the daily
-- cap counts these), and of the pages queued 2 to 9 days ago, how many were
-- finished and how many of those got at least one note.
create function everything_demand_report()
returns table (kind text, queued_24h int, settled int, checked int, with_notes int)
language sql stable set search_path = public as $$
  select q.kind,
         count(*) filter (where q.queued_at > now() - interval '24 hours')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days' and i.status = 'done')::int,
         count(*) filter (where q.queued_at <= now() - interval '2 days' and exists (
           select 1 from everything_claims c join everything_notes n on n.claim_id = c.id where c.item_id = i.id))::int
    from everything_demand_queued q
    left join everything_items i on everything_visit_page(i.url) = q.page_url
   where q.queued and q.queued_at > now() - interval '9 days'
   group by q.kind;
$$;

comment on function everything_demand_report() is
  'Per kind of page queued by reader demand: pages queued in the last 24 hours, and of those queued 2 to 9 days ago how many were finished and how many got a note (GOO-793).';

revoke all on function everything_demand_report() from public, anon, authenticated;
grant execute on function everything_demand_report() to service_role;
