-- One meaning of "reader" (GOO-182).
--
-- Migration 089 counted two kinds of reader per creator: every browser that
-- opened anything of theirs ("readers"), and the browsers among those that
-- opened at least two different pages ("regular readers"). Only the second
-- ever decided anything, and having both confused everyone who read the
-- dashboard. From here on a reader IS a browser that opened at least
-- min_pages different pages of a creator, and the other number is gone.
--
-- The same change fixes how pages are told apart. They used to be compared as
-- raw address strings. YouTube rewrites the address a moment after a video
-- loads, for example by dropping a tracking parameter, and the extension then
-- records the video a second time under the new spelling. Compared as strings,
-- that one video was two different pages, which is exactly what made a browser
-- a reader. In September 2026 this turned three people who had each watched a
-- single Jimmy Kimmel video into two readers. Pages are now compared through
-- everything_visit_page below, which gives every spelling of one page the same
-- value. No row is changed or deleted, so the visit number still includes the
-- duplicate rows.
--
-- Two functions are dropped:
--   everything_two_readers_seen  The walk kept an older rule, counting raw visit
--                                rows, until some creator had been opened by two
--                                different browsers. That became true long ago
--                                and can never become false, so the old rule and
--                                the question behind it are gone.
--   everything_creator_visits    The dashboard's creator leaderboard, removed
--                                from the dashboard in September 2026. Nothing
--                                calls it.
--
-- ORDER: apply this after the pull request is merged. The pipeline that is
-- running before the merge reads regular_readers, which no longer exists here,
-- and would then see no readers at all and walk only prioritised creators. The
-- other way round is harmless: the merged code on the old functions reads the
-- old "readers" column, which is the looser count, for the few minutes until
-- this is applied.

-- ---------------------------------------------------------------------------
-- The value that decides whether two visit rows are the same page. A YouTube
-- video becomes its plain watch address, whichever of its address forms the
-- row carries. Every other address loses its query string, its fragment and
-- any trailing slash. On the sites the extension records, those carry only
-- tracking and positions: Substack's ?selection=, LessWrong's
-- ?recombeeRecommId=, and the like.
create or replace function everything_visit_page(url text)
returns text
language sql
immutable
as $$
  select coalesce(
    'https://www.youtube.com/watch?v=' || coalesce(
      (regexp_match(url, '^https?://([\w-]+\.)?youtube\.com/watch\?(.*&)?v=([\w-]+)', 'i'))[3],
      (regexp_match(url, '^https?://([\w-]+\.)?youtube\.com/(shorts|live|embed)/([\w-]+)', 'i'))[3],
      (regexp_match(url, '^https?://(www\.)?youtu\.be/([\w-]+)', 'i'))[2]
    ),
    regexp_replace(url, '/*([?#].*)?$', '')
  );
$$;

comment on function everything_visit_page(text) is
  'One value per page for a visit row''s address: a YouTube video''s plain watch address, or any other address without its query string, fragment and trailing slash. Used to count different pages (GOO-182).';

-- ---------------------------------------------------------------------------
-- The numbers the walk ranks by, per creator. The creator key is unchanged
-- from migration 089.
--   visits   every row for that creator, with or without a reader hash.
--   pages    different pages opened, over rows that have a reader hash.
--   readers  reader hashes that opened at least min_pages different pages.
-- A return column is removed, which cannot be done in place, so the function is
-- dropped and created again.
drop function if exists everything_creator_attention(timestamptz, int);

create function everything_creator_attention(since timestamptz, min_pages int)
returns table (
  feed_url text,
  visits bigint,
  pages bigint,
  readers bigint
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
      everything_visit_page(v.url) as page,
      v.reader_hash
    from everything_link_visits v
    where v.visited_at >= since
  ),
  -- Creators are grouped by the lower-cased address, because two capitalisations
  -- of one feed are one creator. The address is reported back in one of its
  -- original capitalisations, since a YouTube /channel/UC... id is
  -- case-sensitive and has to be walked as it was written.
  named as (
    select lower(feed_url) as feed_key, feed_url, page, reader_hash
    from visit where feed_url is not null
  ),
  -- One row per browser and creator, holding how many different pages of that
  -- creator the browser opened.
  browser as (
    select feed_key, reader_hash, count(distinct page) as pages
    from named
    where reader_hash is not null
    group by feed_key, reader_hash
  )
  select
    max(n.feed_url) as feed_url,
    count(*) as visits,
    count(distinct n.page) filter (where n.reader_hash is not null) as pages,
    coalesce(max(b.readers), 0) as readers
  from named n
  left join (
    select feed_key, count(*) filter (where pages >= min_pages) as readers
    from browser
    group by feed_key
  ) b on b.feed_key = n.feed_key
  group by n.feed_key;
$$;

comment on function everything_creator_attention(timestamptz, int) is
  'Visits, pages and readers per creator since a given time. A reader is one reader hash that opened at least min_pages different pages of that creator (GOO-182).';

revoke execute on function everything_creator_attention(timestamptz, int) from public, anon, authenticated;
grant execute on function everything_creator_attention(timestamptz, int) to service_role;

drop function if exists everything_two_readers_seen();
drop function if exists everything_creator_visits(int, int);

-- ---------------------------------------------------------------------------
-- The dashboard's Recent posts table. author_readers now uses the same meaning
-- as the walk, so the dashboard shows the number that decides which creators
-- are checked. min_pages is passed by the dashboard from MIN_PAGES_FOR_A_READER
-- in src/everything-shared/readers.ts, as the pipeline does, so the rule has
-- one home. Everything else is unchanged from migration 095. The new argument
-- changes the signature, so the old function is dropped.
drop function if exists everything_recent_posts(int, int);

create function everything_recent_posts(max_posts int, window_days int, min_pages int)
returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  author_visits bigint,
  author_readers bigint,
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
  visit as (
    select
      v.item_id,
      v.reader_hash,
      everything_visit_page(v.url) as page,
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url
    from everything_link_visits v
    where v.visited_at >= now() - make_interval(days => window_days)
  ),
  attributed as (
    select coalesce(item.project_id, feed_project.id) as project_id, visit.reader_hash, visit.page
    from visit
    left join everything_items item on item.id = visit.item_id
    left join everything_projects feed_project
      on visit.feed_url is not null
     and lower(feed_project.feed_url) = lower(visit.feed_url)
  ),
  author_visits as (
    select attributed.project_id, count(*) as visits
    from attributed
    where attributed.project_id in (select recent.project_id from recent)
    group by attributed.project_id
  ),
  author_browsers as (
    select attributed.project_id, attributed.reader_hash, count(distinct attributed.page) as pages
    from attributed
    where attributed.project_id in (select recent.project_id from recent)
      and attributed.reader_hash is not null
    group by attributed.project_id, attributed.reader_hash
  ),
  author_readers as (
    select project_id, count(*) filter (where pages >= min_pages) as readers
    from author_browsers
    group by project_id
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
    coalesce(av.visits, 0), coalesce(ar.readers, 0),
    coalesce(cc.extracted, 0), coalesce(cc.checked, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join author_visits av on av.project_id = r.project_id
  left join author_readers ar on ar.project_id = r.project_id
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc
$$;

comment on function everything_recent_posts(int, int, int) is
  'The posts the pipeline finished most recently (up to 200), newest first, with their author''s visits and readers over the last window_days days, claims extracted, claims checked and AI notes written. A reader is one reader hash that opened at least min_pages different pages of the author (GOO-182).';

revoke all on function everything_recent_posts(int, int, int) from public;
grant execute on function everything_recent_posts(int, int, int) to anon, authenticated;
