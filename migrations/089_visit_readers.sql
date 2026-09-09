-- Visits count people, not page loads (GOO-135).
--
-- Until now a visit row carried nothing that identified the browser it came
-- from, so one person reloading one post four times looked exactly like four
-- people reading four posts, and the walk spent its budget on whichever
-- creator produced the most page loads.
--
-- A row now carries a reader hash: the extension keeps a random secret that
-- never leaves the device and sends a SHA-256 hash of that secret combined
-- with the creator's feed address. Every visit from one browser to one creator
-- carries the same value, so readers of a creator can be counted. A visit to a
-- different creator carries an unrelated value, so the rows can never be
-- assembled into one person's reading across creators. The mirror of this in
-- TypeScript is src/everything-shared/readerHash.ts.
--
-- The counting vocabulary these functions use, all over the ranking window:
--   visits          every row for that creator, with or without a reader hash.
--   pages           different page addresses opened, over rows that have a hash.
--   readers         different reader hashes.
--   regular readers reader hashes that opened at least min_pages different
--                   pages of that creator. This is what the walk ranks by.

alter table everything_link_visits
  add column reader_hash text check (reader_hash is null or reader_hash ~ '^[0-9a-f]{64}$');

comment on column everything_link_visits.reader_hash is
  'SHA-256 of a secret held only by the browser, combined with the creator''s feed address, so it is one value per browser and per creator. Null on rows written before GOO-135, on rows from extension copies that never updated, and on rows whose creator could not be determined on the page.';

-- The insert policy and the client grant are unchanged: the grant is on the
-- table and the policy is `with check (true)`, so the browser can write the new
-- column and still cannot read any of this back.

-- Both reading functions filter on visited_at and there was no index on it.
-- Counting distinct readers makes that scan hotter than counting rows did.
create index everything_link_visits_visited_at_idx on everything_link_visits (visited_at desc);

-- ---------------------------------------------------------------------------
-- The numbers the walk ranks by. This replaces everything_visit_counts from
-- migration 083, which returned visits alone. A return type cannot be changed
-- in place, so the old function is dropped rather than replaced.
--
-- The creator key is the one migration 083 used and is kept so the visit number
-- stays comparable: the feed address the extension captured, falling back to
-- deriving a Substack publication from the page's hostname for rows written
-- before that capture existed. Those old rows have no reader hash, so they add
-- to visits and to nothing else.

drop function if exists everything_visit_counts(timestamptz);

create or replace function everything_creator_attention(since timestamptz, min_pages int)
returns table (
  feed_url text,
  visits bigint,
  pages bigint,
  readers bigint,
  regular_readers bigint
)
language sql
stable
as $$
  with visit as (
    select
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url,
      v.url,
      v.reader_hash
    from everything_link_visits v
    where v.visited_at >= since
  ),
  -- Creators are grouped by the lower-cased address, because two capitalisations
  -- of one feed are one creator and counting them apart would count one reader
  -- twice. The address is reported back in one of its original capitalisations,
  -- since a YouTube /channel/UC... id is case-sensitive and has to be walked as
  -- it was written.
  named as (
    select lower(feed_url) as feed_key, feed_url, url, reader_hash
    from visit where feed_url is not null
  ),
  -- One row per reader and creator, holding how much of that creator they read.
  reader as (
    select feed_key, reader_hash, count(distinct url) as pages
    from named
    where reader_hash is not null
    group by feed_key, reader_hash
  )
  select
    max(n.feed_url) as feed_url,
    count(*) as visits,
    count(distinct n.url) filter (where n.reader_hash is not null) as pages,
    count(distinct n.reader_hash) as readers,
    coalesce(max(r.regular_readers), 0) as regular_readers
  from named n
  left join (
    select feed_key, count(*) filter (where pages >= min_pages) as regular_readers
    from reader
    group by feed_key
  ) r on r.feed_key = n.feed_key
  group by n.feed_key;
$$;

comment on function everything_creator_attention(timestamptz, int) is
  'Visits, pages, readers and regular readers per creator since a given time. A regular reader is one reader hash that opened at least min_pages different pages of that creator (GOO-135).';

revoke execute on function everything_creator_attention(timestamptz, int) from public, anon, authenticated;
grant execute on function everything_creator_attention(timestamptz, int) to service_role;

-- ---------------------------------------------------------------------------
-- The two-reader proof. Rows written before GOO-135 have no reader hash and
-- can never satisfy the new rule, so the walk keeps its old rule until this
-- answers true: has any single creator ever been visited by two different
-- readers? It is asked over all history rather than over the ranking window, so
-- it flips once and never flips back.
--
-- This is the only form the question can take. Reader hashes are per creator by
-- design, so the table can never say how many readers exist in total; a person
-- who reads five creators appears as five unrelated values.

create or replace function everything_two_readers_seen()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from everything_link_visits
    where reader_hash is not null and feed_url is not null
    group by lower(regexp_replace(feed_url, '/+$', ''))
    having count(distinct reader_hash) >= 2
  );
$$;

revoke execute on function everything_two_readers_seen() from public, anon, authenticated;
grant execute on function everything_two_readers_seen() to service_role;

-- ---------------------------------------------------------------------------
-- The analytics dashboard's leaderboard gains the same two reader numbers. It
-- keeps its ordering by visits, and it deliberately offers no total across
-- creators: adding reader counts up would count reader-and-creator pairs, not
-- people.

-- A return type cannot be changed in place, so this one is dropped too.
drop function if exists everything_creator_visits(int);

create function everything_creator_visits(window_days int default null)
returns table (
  creator text,
  visits bigint,
  readers bigint,
  regular_readers bigint,
  processed bigint,
  notes bigint,
  errored bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with visit as (
    select
      v.item_id,
      v.url,
      v.reader_hash,
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url
    from everything_link_visits v
    where window_days is null or v.visited_at >= now() - make_interval(days => window_days)
  ),
  attributed as (
    select
      coalesce(item_project.id, feed_project.id) as project_id,
      coalesce(
        item_project.name,
        feed_project.name,
        case
          when visit.feed_url is not null then regexp_replace(visit.feed_url, '^https?://(www\.)?', '')
          else regexp_replace(visit.url, '^https?://(www\.)?([^/]+).*$', '\2')
        end
      ) as creator,
      visit.url,
      visit.reader_hash
    from visit
    left join everything_items i on i.id = visit.item_id
    left join everything_projects item_project on item_project.id = i.project_id
    left join everything_projects feed_project
      on visit.feed_url is not null
     and lower(feed_project.feed_url) = lower(visit.feed_url)
  ),
  reader as (
    select creator, reader_hash, count(distinct url) as pages
    from attributed
    where reader_hash is not null
    group by creator, reader_hash
  ),
  reader_counts as (
    -- The 2 mirrors MIN_PAGES_FOR_A_REGULAR_READER in src/everything/creatorRanking.ts.
    select creator, count(*) as readers, count(*) filter (where pages >= 2) as regular_readers
    from reader
    group by creator
  ),
  visit_counts as (
    select creator, max(project_id::text)::uuid as project_id, count(*) as visits
    from attributed
    group by creator
  ),
  item_stats as (
    select
      i.project_id,
      count(*) filter (where i.status = 'done') as processed,
      count(*) filter (where i.status = 'error') as errored
    from everything_items i
    group by i.project_id
  ),
  note_counts as (
    select i.project_id, count(*) as notes
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    join everything_items i on i.id = c.item_id
    group by i.project_id
  )
  select
    vc.creator,
    vc.visits,
    coalesce(rc.readers, 0) as readers,
    coalesce(rc.regular_readers, 0) as regular_readers,
    coalesce(s.processed, 0) as processed,
    coalesce(nc.notes, 0) as notes,
    coalesce(s.errored, 0) as errored
  from visit_counts vc
  left join reader_counts rc on rc.creator = vc.creator
  left join item_stats s on s.project_id = vc.project_id
  left join note_counts nc on nc.project_id = vc.project_id
  order by vc.visits desc, vc.creator
$$;

revoke all on function everything_creator_visits(int) from public;
grant execute on function everything_creator_visits(int) to anon, authenticated;
