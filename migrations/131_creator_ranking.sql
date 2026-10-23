-- 131: the walk's ranking of creators, for the analytics dashboard (GOO-531).
--
-- The walk is the step of each feed run that picks the next post to check. It
-- goes down a ranked list of creators: those holding priority first, then
-- everyone whose score is at least the walk's minimum over at least the walk's
-- minimum number of visited posts, highest score first
-- (rankCreators in src/everything/creatorRanking.ts). The list is computed
-- fresh on every run, so computing it now shows what the next walk will see.
--
-- This function returns that list, one row per creator, with three numbers
-- that each cover the creator's last last_posts posts:
--
-- 1. The score, unchanged from everything_creator_visit_scores (migration 123):
--    the average number of different people per post, over the creator's most
--    recently visited posts.
--
-- 2. How long after publication we finish checking a post. This is the median
--    of processed_at minus published_at, over the creator's most recently
--    published posts that were checked as a whole page. published_at is a day
--    without a time, so it is read as midnight UTC, and the delay is only
--    accurate to about a day. Only new posts count, meaning posts published
--    on or after the day we first saw any post of the creator. Two kinds of
--    post are older, and their delay says how old they are, not how fast we
--    are. The first walk of a creator catches up on their 5 newest posts,
--    which can be months old for someone who posts rarely. The walk also
--    checks a creator's most popular posts of all time, and a creator's old
--    post can become popular later. Posts in the creator's cached top list
--    (everything_top_posts) are left out for that second reason.
--
-- 3. How often a visitor votes. Visits and votes cannot be matched person to
--    person: a visit carries a reader hash made on the device, a vote carries
--    an account id, and that separation is deliberate (GOO-135). So this is a
--    ratio of two counts, per post and summed over the creator's most recently
--    visited posts that have notes. The visitors of a post are the different
--    reader hashes that opened it after its first note appeared, since nobody
--    could vote before that. Its voters are the different accounts that voted
--    on any of its notes from the extension. Website votes are left out,
--    because only the extension records visits, so website voters are mostly
--    not among the visitors. Votes by admins are left out too.
--
-- The walk's minimum score and minimum number of visited posts live in the
-- code (MIN_SCORE_TO_WALK and MIN_VISITED_POSTS_TO_WALK in
-- src/everything-core/readers.ts) and are passed in, as last_posts already is.
-- The rows come back unordered. The dashboard sorts them with the walk's own
-- comparator, so the order rule exists only once.
--
-- On 2026-10-22 production had 147 such creators before the minimum number of
-- posts (GOO-536) existed, and the call took 280 ms.
--
-- The anon key cannot read visits, votes or the top-post cache, so this runs
-- with its owner's rights and returns only counts per creator.

create function everything_creator_ranking(last_posts int, min_score float8, min_posts int)
returns table (
  feed_url text,
  project_slug text,
  project_name text,
  priority_until timestamptz,
  visitors_per_post float8,
  score_posts bigint,
  people bigint,
  delay_posts bigint,
  median_delay_hours float8,
  vote_posts bigint,
  vote_visitors bigint,
  extension_voters bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with score as (
    select lower(rtrim(s.feed_url, '/')) as creator_key, s.feed_url, s.visitors_per_post, s.posts, s.people
    from everything_creator_visit_scores(last_posts) s
  ),
  walked as (
    select coalesce(lower(rtrim(p.feed_url, '/')), s.creator_key) as creator_key,
           coalesce(p.feed_url, s.feed_url) as feed_url,
           p.id as project_id, p.slug, p.name,
           case when p.priority_until > now() then p.priority_until end as priority_until,
           s.visitors_per_post, s.posts, s.people
    from (select * from everything_projects where feed_url is not null) p
    full join score s on s.creator_key = lower(rtrim(p.feed_url, '/'))
    where p.priority_until > now()
       or (s.visitors_per_post >= min_score and s.posts >= min_posts)
  ),
  followed_since as (
    select w.creator_key, (min(i.created_at) at time zone 'UTC')::date as first_seen_day
    from walked w
    join everything_items i on i.project_id = w.project_id
    group by w.creator_key
  ),
  delay as (
    select w.creator_key,
           count(*) as posts,
           percentile_cont(0.5) within group (order by extract(epoch from d.processed_at - (d.published_at::timestamp at time zone 'UTC')) / 3600) as median_hours
    from walked w
    join followed_since f using (creator_key)
    cross join lateral (
      select i.published_at, i.processed_at
      from everything_items i
      where i.project_id = w.project_id
        and i.status = 'done'
        and i.checked_scope = 'page'
        and i.published_at is not null
        and i.processed_at is not null
        and i.published_at >= f.first_seen_day
        and not exists (select 1 from everything_top_posts t where t.url = i.url)
      order by i.published_at desc, i.processed_at desc
      limit last_posts
    ) d
    group by w.creator_key
  ),
  noted_page as (
    select w.creator_key, everything_visit_page(i.url) as page_url,
           array_agg(distinct i.id) as item_ids, min(n.created_at) as first_note_at
    from walked w
    join everything_items i on i.project_id = w.project_id
    join everything_claims c on c.item_id = i.id
    join everything_notes n on n.claim_id = c.id
    group by 1, 2
  ),
  visited_noted_page as (
    select np.creator_key, np.page_url, np.item_ids,
           count(distinct v.reader_hash) as visitors,
           row_number() over (partition by np.creator_key order by max(v.visited_at) desc, np.page_url) as recency
    from noted_page np
    join everything_link_visits v
      on lower(rtrim(v.feed_url, '/')) = np.creator_key
     and v.page_url = np.page_url
     and v.reader_hash is not null
     and v.visited_at >= np.first_note_at
    group by np.creator_key, np.page_url, np.item_ids
  ),
  team_account as (
    select u.id
    from auth.users u
    join everything_admins a on a.email = lower(u.email)
  ),
  page_voters as (
    select vp.creator_key, vp.page_url, count(distinct vt.voter_id) as voters
    from visited_noted_page vp
    join everything_claims c on c.item_id = any (vp.item_ids)
    join everything_notes n on n.claim_id = c.id
    join everything_votes vt on vt.note_id = n.id
    where vp.recency <= last_posts
      and vt.platform = 'extension'
      and vt.voter_id not in (select id from team_account)
    group by vp.creator_key, vp.page_url
  ),
  votes as (
    select vp.creator_key,
           count(*) as posts,
           sum(vp.visitors)::bigint as visitors,
           coalesce(sum(pv.voters), 0)::bigint as voters
    from visited_noted_page vp
    left join page_voters pv using (creator_key, page_url)
    where vp.recency <= last_posts
    group by vp.creator_key
  )
  select w.feed_url, w.slug, w.name, w.priority_until,
         w.visitors_per_post, w.posts, w.people,
         d.posts, d.median_hours,
         vo.posts, vo.visitors, vo.voters
  from walked w
  left join delay d using (creator_key)
  left join votes vo using (creator_key);
$$;

comment on function everything_creator_ranking(int, float8, int) is
  'The creators the auto-enqueue walk would go through now: open priority, or a score of at least min_score over at least min_posts visited posts. Per creator: the score, the median hours from publication to the end of processing over their last_posts most recently published checked posts published on or after the day we first saw the creator and outside their top list, and extension voters and visitors summed over their last_posts most recently visited posts with notes (GOO-531).';

revoke execute on function everything_creator_ranking(int, float8, int) from public;
grant execute on function everything_creator_ranking(int, float8, int) to anon, authenticated, service_role;
