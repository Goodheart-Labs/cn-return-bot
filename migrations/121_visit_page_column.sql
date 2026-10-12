-- Keep the creator score fast as the visits table grows (GOO-400).
--
-- everything_creator_visit_scores (migration 119) has no time window, so it
-- reads every visit row on every call. For each row it worked out the creator
-- and the page with regular expressions, and that was almost all of its time.
-- On 2026-10-12 production had 12,532 visit rows. Reading them took 3 ms, but
-- working out the two values took about 400 ms. The table grows by about
-- 10,000 rows a month, and the dashboard calls the function under the anon
-- role, which stops every statement after 3 seconds.
--
-- The page is now stored on each row, in a generated column. Postgres computes
-- a generated column itself from the other columns of the same row. It filled
-- the column for every existing row when this migration added it, and it fills
-- it for every new row as part of the insert. So no row is ever without it,
-- and the extension did not change.
--
-- The creator needs no column of its own. The extension computes a reader hash
-- only when it knows the creator's feed address, because the hash is made from
-- that address (writeVisit in src/everything-extension/utils/linkVisits.ts).
-- The score counts only rows that have a hash, so every row it reads already
-- carries the feed address in feed_url. On 2026-10-12 none of the 9,124 rows
-- with a hash lacked one. The fallback that derived a Substack publication
-- from the page address served only older rows without a hash, which the
-- score never counts. So everything_visit_creator is dropped.
--
-- ORDER: this can be applied at any time. The function keeps its arguments and
-- its result columns, and no code reads the new column directly.

alter table everything_link_visits
  add column page_url text generated always as (everything_visit_page(url)) stored;

comment on column everything_link_visits.page_url is
  'One value per page, computed by Postgres from url with everything_visit_page: every spelling of one page gets the same value. Used to count different pages (GOO-400).';

comment on function everything_visit_page(text) is
  'One value per page for a visit row''s address: a YouTube video''s plain watch address, or any other address without its query string, fragment and trailing slash. The stored column everything_link_visits.page_url is computed with it. Postgres does not recompute stored rows when this function is replaced, so a change here must drop and re-add that column (GOO-182, GOO-400).';

-- ---------------------------------------------------------------------------
-- The same scores as migration 119, from the stored page. The feed address
-- still loses a trailing slash and is grouped lower-cased. Both are plain
-- string operations and cost nothing measurable.
create or replace function everything_creator_visit_scores(last_posts int)
returns table (
  feed_url text,
  visitors_per_post float8,
  posts bigint,
  people bigint
)
language sql
stable
as $$
  with named as (
    select
      lower(rtrim(v.feed_url, '/')) as feed_key,
      rtrim(v.feed_url, '/') as feed_url,
      v.page_url,
      v.reader_hash,
      v.visited_at
    from everything_link_visits v
    where v.reader_hash is not null
      and v.feed_url is not null
  ),
  -- One row per post, holding how many different people opened it and how
  -- recent it is among the creator's visited posts. Ties in the last visit
  -- time are broken by the address, so the same posts are picked on every run.
  post as (
    select
      feed_key,
      count(distinct reader_hash) as visitors,
      row_number() over (partition by feed_key order by max(visited_at) desc, page_url) as recency
    from named
    group by feed_key, page_url
  ),
  creator as (
    select feed_key, max(feed_url) as feed_url, count(distinct reader_hash) as people
    from named
    group by feed_key
  )
  select c.feed_url, avg(p.visitors)::float8, count(*), c.people
  from creator c
  join post p on p.feed_key = c.feed_key and p.recency <= last_posts
  group by c.feed_key, c.feed_url, c.people;
$$;

drop function everything_visit_creator(text, text);
