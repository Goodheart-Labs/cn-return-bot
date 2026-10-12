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
-- Storing the page alone still leaves a function that reads and sorts every
-- row, so its time keeps growing with the table. So the rule is now written
-- for one creator, and an index on the creator lets that read only the
-- creator's own rows. The dashboard asks only about the authors of the posts it
-- shows, so its time no longer depends on the size of the table. The walk ranks
-- every creator and still reads every row, under a 30-second limit.
--
-- ORDER: this can be applied at any time. Every function keeps its arguments
-- and its result columns, and no code reads the new column directly.

alter table everything_link_visits
  add column page_url text generated always as (everything_visit_page(url)) stored;

comment on column everything_link_visits.page_url is
  'One value per page, computed by Postgres from url with everything_visit_page: every spelling of one page gets the same value. Used to count different pages (GOO-400).';

comment on function everything_visit_page(text) is
  'One value per page for a visit row''s address: a YouTube video''s plain watch address, or any other address without its query string, fragment and trailing slash. The stored column everything_link_visits.page_url is computed with it. Postgres does not recompute stored rows when this function is replaced, so a change here must drop and re-add that column (GOO-182, GOO-400).';

-- ---------------------------------------------------------------------------
-- The creator key of a visit row is its feed address, lower-cased and without
-- a trailing slash. Two capitalisations of one feed are one creator, and the
-- extension makes the reader hash from the same normalised address
-- (normalizeFeedUrl in src/everything-core/pageUrls.ts).
--
-- This is an expression index, a Postgres feature: it stores the computed key
-- of every row inside the index, sorted. A query that asks for one creator's
-- rows with exactly this expression looks the key up and reads only that
-- creator's rows. Only rows with a reader hash are in the index, because only
-- they count.
create index everything_link_visits_creator_idx
  on everything_link_visits (lower(rtrim(feed_url, '/')))
  where reader_hash is not null;

-- ---------------------------------------------------------------------------
-- One creator's score. This is the only place the scoring rule is written.
--   visitors_per_post  the average number of different people per post, over
--                      the creator's last_posts most recently visited posts.
--   posts              how many posts that average covers, at most last_posts.
--   people             different people who opened anything of the creator.
-- It returns no row for a creator nobody with a reader hash visited. Ties in
-- the last visit time are broken by the page address, so the same posts are
-- picked on every run.
create function everything_creator_visit_score(creator_key text, last_posts int)
returns table (
  visitors_per_post float8,
  posts bigint,
  people bigint
)
language sql
stable
as $$
  with visit as (
    select v.page_url, v.reader_hash, v.visited_at
    from everything_link_visits v
    where lower(rtrim(v.feed_url, '/')) = creator_key
      and v.reader_hash is not null
  ),
  last_post as (
    select count(distinct reader_hash) as visitors
    from visit
    group by page_url
    order by max(visited_at) desc, page_url
    limit last_posts
  )
  select avg(visitors)::float8, count(*), (select count(distinct reader_hash) from visit)
  from last_post
  having count(*) > 0;
$$;

comment on function everything_creator_visit_score(text, int) is
  'One creator''s average number of different reader hashes per post over their last_posts most recently visited posts, how many posts that covers, and how many different reader hashes visited them at all. creator_key is the lower-cased feed address without a trailing slash. Reads only that creator''s rows through everything_link_visits_creator_idx (GOO-400).';

revoke execute on function everything_creator_visit_score(text, int) from public, anon, authenticated;
grant execute on function everything_creator_visit_score(text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Every visited creator's score, for the walk, which ranks all of them. The
-- arguments and result columns are the ones from migration 119, so the walk's
-- code is unchanged. The address is reported back in one of its original
-- capitalisations, since a YouTube /channel/UC... id is case-sensitive and has
-- to be walked as it was written.
--
-- This still reads every row with a reader hash, so its time grows with the
-- table. The walk runs as service_role, which Supabase stops after 30 seconds
-- rather than the 3 seconds the dashboard gets.
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
  with creator as (
    select lower(rtrim(v.feed_url, '/')) as creator_key, max(rtrim(v.feed_url, '/')) as feed_url
    from everything_link_visits v
    where v.reader_hash is not null
      and v.feed_url is not null
    group by 1
  )
  select c.feed_url, s.visitors_per_post, s.posts, s.people
  from creator c
  cross join lateral everything_creator_visit_score(c.creator_key, last_posts) s;
$$;

-- ---------------------------------------------------------------------------
-- The dashboard's Recent posts table now scores only the authors of the posts
-- it shows, one index lookup each. Its time then depends on how much those
-- authors were read, not on the size of the visits table. Everything else is
-- unchanged from migration 119.
create or replace function everything_recent_posts(max_posts int, last_posts int)
returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  author_visitors_per_post float8,
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
    select i.id, i.title, i.url, i.project_id, i.checked_scope, i.published_at, i.processed_at
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
    order by i.processed_at desc
    limit least(greatest(max_posts, 1), 200)
  ),
  author_score as (
    select p.id as project_id, s.visitors_per_post
    from everything_projects p
    cross join lateral everything_creator_visit_score(lower(rtrim(p.feed_url, '/')), last_posts) s
    where p.id in (select recent.project_id from recent)
      and p.feed_url is not null
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
    s.visitors_per_post,
    coalesce(cc.extracted, 0), coalesce(cc.checked, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join author_score s on s.project_id = r.project_id
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc
$$;

drop function everything_visit_creator(text, text);
