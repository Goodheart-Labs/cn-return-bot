-- Rank creators by the average number of people per post (GOO-257).
--
-- Until now the walk ranked creators by "readers": browsers that opened at
-- least two different pages of a creator inside the last 14 days. That rule
-- worked against creators who post rarely. A person who reads every post of a
-- monthly writer almost never opens two of them inside 14 days, so the writer
-- had no readers at all.
--
-- From here on a creator's score is the average number of different people
-- per post, taken over the creator's 10 most recently visited posts. "Different
-- people" means different reader hashes, so a visit row without a hash counts
-- for nothing. There is no time window: the 10 posts are the 10 that were
-- visited most recently, however long ago that was. One person who opens many
-- posts adds about one person to each of them, so a binge-watcher cannot lift
-- a creator's average. The function scores every visited creator. The walk
-- then skips creators with fewer than two visited posts (creatorRanking.ts).
--
-- Two functions replace everything_creator_attention and change the dashboard's
-- everything_recent_posts. The number of posts is passed in by both callers
-- from LAST_POSTS_PER_CREATOR in src/everything-core/readers.ts, so the rule
-- has one home.
--
-- ORDER: apply this right after the pull request is merged. Until it is
-- applied, the merged walk calls a function that does not exist yet, and a
-- feed run in that gap fails at its start and is retried by the next one.

-- ---------------------------------------------------------------------------
-- The creator a visit row belongs to. The extension records the feed address
-- when it can tell it. For an older row without one, a page on a
-- *.substack.com subdomain still names its publication. The same expression
-- was written out twice in migration 102; it now lives here once.
create or replace function everything_visit_creator(feed_url text, url text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(regexp_replace(feed_url, '/+$', ''), ''),
    case
      when url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
      then 'https://' || lower((regexp_match(url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
    end
  );
$$;

comment on function everything_visit_creator(text, text) is
  'The creator''s feed address for one visit row: the recorded feed address without a trailing slash, or the publication of a *.substack.com page. Null when neither is known (GOO-257).';

-- ---------------------------------------------------------------------------
-- One row per creator that anyone with a reader hash visited.
--   visitors_per_post  the average number of different people per post, over
--                      the creator's last_posts most recently visited posts.
--   posts              how many posts that average covers, at most last_posts.
--   people             different people who opened anything of the creator.
--                      The walk uses it only to order creators whose averages
--                      tie.
-- Creators are grouped by the lower-cased address, because two capitalisations
-- of one feed are one creator. The address is reported back in one of its
-- original capitalisations, since a YouTube /channel/UC... id is
-- case-sensitive and has to be walked as it was written.
drop function if exists everything_creator_attention(timestamptz, int);

create function everything_creator_visit_scores(last_posts int)
returns table (
  feed_url text,
  visitors_per_post float8,
  posts bigint,
  people bigint
)
language sql
stable
as $$
  with visit as (
    select
      everything_visit_creator(v.feed_url, v.url) as feed_url,
      everything_visit_page(v.url) as page,
      v.reader_hash,
      v.visited_at
    from everything_link_visits v
    where v.reader_hash is not null
  ),
  named as (
    select lower(feed_url) as feed_key, feed_url, page, reader_hash, visited_at
    from visit
    where feed_url is not null
  ),
  -- One row per post, holding how many different people opened it and how
  -- recent it is among the creator's visited posts. Ties in the last visit
  -- time are broken by the address, so the same posts are picked on every run.
  post as (
    select
      feed_key,
      count(distinct reader_hash) as visitors,
      row_number() over (partition by feed_key order by max(visited_at) desc, page) as recency
    from named
    group by feed_key, page
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

comment on function everything_creator_visit_scores(int) is
  'Per creator: the average number of different reader hashes per post over the creator''s last_posts most recently visited posts, how many posts that covers, and how many different reader hashes visited the creator at all (GOO-257).';

revoke execute on function everything_creator_visit_scores(int) from public, anon, authenticated;
grant execute on function everything_creator_visit_scores(int) to service_role;

-- ---------------------------------------------------------------------------
-- The dashboard's Recent posts table shows each author's score, the number the
-- walk orders creators by. It used to show readers and different pages over a
-- window. The author is found through the post's project and that project's
-- feed address, so a post in a project without a feed, such as "web", shows no
-- score. Everything else is unchanged from migration 102. The arguments
-- change, so the old function is dropped.
drop function if exists everything_recent_posts(int, int, int);

create function everything_recent_posts(max_posts int, last_posts int)
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
  left join everything_creator_visit_scores(last_posts) s on lower(s.feed_url) = lower(p.feed_url)
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc
$$;

comment on function everything_recent_posts(int, int) is
  'The posts the pipeline finished most recently (up to 200), newest first, with their author''s average number of different people per post over the author''s last_posts most recently visited posts, claims extracted, claims checked and AI notes written (GOO-257).';

revoke all on function everything_recent_posts(int, int) from public;
grant execute on function everything_recent_posts(int, int) to anon, authenticated;
