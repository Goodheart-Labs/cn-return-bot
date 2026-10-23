-- 132: the exact publication time, and the creator ranking's delay measured
-- from it (GOO-549).
--
-- everything_items.published_at is a day without a time. Migration 131
-- measured "how long after publication we finish checking a post" from
-- midnight UTC of that day, which adds up to 24 hours. On 2026-10-23 the
-- dashboard showed a median of 20 hours for Zvi, while his last ten posts took
-- about 6 hours from their real publication times.
--
-- published_time holds the exact moment of publication. The walk fills it at
-- enqueue from the source's own listing: the RSS pubDate of a Substack post,
-- the postedAt of a forum post, and the upload time the YouTube Data API
-- reports. It stays null for an item that did not come from such a listing,
-- such as a reader request or an all-time top post. Older items were filled
-- once by src/scripts_jim/2026_10_23_post_processing_delay/backfillPublishedTime.ts.
--
-- The ranking's delay now counts a post only when it has an exact time and was
-- published after the walk first enqueued anything from its creator. Migration
-- 131 instead counted posts from the day we first had any item of the creator,
-- which can be a reader request. A post published before the first walk is
-- catch-up, and its delay says how old it was rather than how fast we are.
-- Feed items are those below the requested tier (priority 2, QUEUE_PRIORITY
-- in src/everything/db.ts). Everything else is as in migration 131.

alter table everything_items add column published_time timestamptz;

comment on column everything_items.published_time is
  'The exact moment the post was published, from the walk''s listing (RSS pubDate, forum postedAt, YouTube upload time). Null when no listing gave one. published_at keeps only the day (GOO-549).';

create or replace function everything_creator_ranking(last_posts int, min_score float8, min_posts int)
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
    select w.creator_key, min(i.created_at) as first_walked_at
    from walked w
    join everything_items i on i.project_id = w.project_id
    where i.priority < 2
    group by w.creator_key
  ),
  delay as (
    select w.creator_key,
           count(*) as posts,
           percentile_cont(0.5) within group (order by extract(epoch from d.processed_at - d.published_time) / 3600) as median_hours
    from walked w
    join followed_since f using (creator_key)
    cross join lateral (
      select i.published_time, i.processed_at
      from everything_items i
      where i.project_id = w.project_id
        and i.status = 'done'
        and i.checked_scope = 'page'
        and i.published_time is not null
        and i.processed_at is not null
        and i.published_time >= f.first_walked_at
        and not exists (select 1 from everything_top_posts t where t.url = i.url)
      order by i.published_time desc
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
  'The creators the auto-enqueue walk would go through now: open priority, or a score of at least min_score over at least min_posts visited posts. Per creator: the score, the median hours from the exact publication time to the end of processing over their last_posts most recently published checked posts published after the walk first enqueued anything from them and outside their top list, and extension voters and visitors summed over their last_posts most recently visited posts with notes (GOO-531, GOO-549).';
