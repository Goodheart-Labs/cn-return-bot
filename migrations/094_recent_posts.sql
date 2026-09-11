-- 094: the Common Notes dashboard's list of recently checked posts.
--
-- One row per post the pipeline finished most recently, newest first: its
-- title, project, publish date and check time, how many visits and readers it
-- had, and what the pipeline got out of it (claims extracted, claims checked,
-- notes written). A post counts as finished under the same rule as the
-- pipeline funnel in migration 092: status done, a checked scope, and a
-- processed_at stamp.
--
-- Matching visits to a post takes two routes. A visit to a page we had
-- already checked carries the post's id. A visit to a page we had not checked
-- yet carries only the address the reader was on, often with extra query
-- parameters, and those visits are usually the ones that got the page
-- checked. So a visit without an id is matched on a normalized key of its
-- address, which everything_page_key computes the same way for both sides.

-- The key two addresses of the same page share. For a YouTube video it is the
-- video id, because the same video appears under watch, youtu.be, shorts and
-- live addresses. For any other page it is the address without its scheme,
-- without www., without query or fragment, and without a trailing slash,
-- lower-cased.
create or replace function everything_page_key(page_url text)
returns text
language sql
immutable
as $$
  select case
    when page_url ~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/'
     and page_url ~ '(?:[?&]v=|youtu\.be/|/shorts/|/live/|/embed/)[A-Za-z0-9_-]{11}'
    then 'youtube:' || (regexp_match(page_url, '(?:[?&]v=|youtu\.be/|/shorts/|/live/|/embed/)([A-Za-z0-9_-]{11})'))[1]
    else lower(regexp_replace(
      regexp_replace(split_part(split_part(page_url, '#', 1), '?', 1), '^https?://(www\.)?', ''),
      '/+$', ''))
  end
$$;

revoke all on function everything_page_key(text) from public;

-- max_posts is capped, so a caller cannot ask the database to join every post
-- it has ever checked against every visit.
create or replace function everything_recent_posts(max_posts int default 100)
returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  visits bigint,
  readers bigint,
  claims_extracted bigint,
  claims_checked bigint,
  notes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select i.id, i.title, i.url, i.project_id, i.checked_scope, i.published_at, i.processed_at,
           everything_page_key(i.url) as page_key
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
    order by i.processed_at desc
    limit least(greatest(max_posts, 1), 200)
  ),
  -- Each visit's key is computed once, and only for visits without a post id.
  -- Matching on "id or key" in a single join made Postgres recompute the key
  -- for every pair of post and visit, which took two seconds, so the two
  -- routes are two plain joins that Postgres can hash.
  visit as materialized (
    select v.item_id, v.reader_hash,
           case when v.item_id is null then everything_page_key(v.url) end as page_key
    from everything_link_visits v
  ),
  matched as (
    select r.id, visit.reader_hash from recent r join visit on visit.item_id = r.id
    union all
    select r.id, visit.reader_hash from recent r join visit on visit.page_key = r.page_key
  ),
  visit_counts as (
    select matched.id, count(*) as visits, count(distinct matched.reader_hash) as readers
    from matched
    group by matched.id
  ),
  claim_counts as (
    select c.item_id,
           count(*) as extracted,
           count(*) filter (where c.status in ('note', 'no_note', 'error')) as checked
    from everything_claims c
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
    group by c.item_id
  ),
  note_counts as (
    select c.item_id, count(*) as notes
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
      and n.author_id is null
      and n.status <> 'hidden'
    group by c.item_id
  )
  select
    r.id, r.title, r.url, p.name, r.checked_scope, r.published_at, r.processed_at,
    coalesce(vc.visits, 0), coalesce(vc.readers, 0),
    coalesce(cc.extracted, 0), coalesce(cc.checked, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join visit_counts vc on vc.id = r.id
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc
$$;

comment on function everything_recent_posts(int) is
  'The posts the pipeline finished most recently (up to 200), newest first, with visits and distinct readers (matched by post id or by everything_page_key of the address), claims extracted, claims checked and AI notes written.';

revoke all on function everything_recent_posts(int) from public;
grant execute on function everything_recent_posts(int) to anon, authenticated;
