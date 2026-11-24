-- The feed readings of cn-x-watch (GOO-874). Every 10 minutes the daemon reads
-- the whole feed X offers its account (src/x-watch/main.ts). Each such read is
-- a walk. For every post of the walk it stores one reading of its view count
-- and the views the post is predicted to get until it is 48 hours old
-- (src/pipeline/utils/viewsToCome.ts).
--
-- The daemon hands a post to Claude only when that prediction clears a
-- threshold. The threshold comes from the posts that arrived in the feed in
-- the last 7 days and their best predictions, which x_watch_best_scores
-- returns.
--
-- The WSDM Cup account's feed shares few posts with the feed that cn-feed-views
-- reads with the first account's keys: on 2026-11-24, 72 of its 320 posts under
-- 48 hours. So it needs readings of its own. About 700 posts a walk make about
-- 100,000 rows a day, kept for good like feed_tweet_views.
--
-- Only the service role writes and reads this table, so the anon and
-- authenticated roles get nothing.

create table x_watch_feed_views (
  x_account text not null check (x_account in ('stilt', 'wsdm')),
  -- When the walk started. All readings of one walk share it.
  walked_at timestamptz not null,
  -- tweet_id is a bigint, as in feed_tweet_views, because 8 bytes instead of
  -- about 20 matter at this count. Read it as text, because JSON would round it.
  tweet_id bigint not null,
  -- When the feed page holding the post came back.
  observed_at timestamptz not null,
  impressions bigint,
  -- The post's position in X's order of the feed, starting at 1.
  feed_rank integer not null,
  -- Null when the walk before did not read the post or a count is missing.
  views_to_come double precision,
  -- One walk's readings and a window of walks are both read through this key.
  primary key (x_account, walked_at, tweet_id)
);

alter table x_watch_feed_views enable row level security;
revoke all on x_watch_feed_views from anon, authenticated;

-- The posts that came into the account's feed since p_since, each with the
-- best prediction it had, best first. A post counts from its first reading,
-- and only if it ever had a positive prediction. cn-x-watch sets its threshold
-- from how many such posts arrive per hour (src/x-watch/pick.ts).
--
-- The first walk of all holds the posts that were already in the feed. They
-- did not arrive then, so they are left out, and history_from is that walk
-- while it is less than 7 days old. history_from is null while there is no
-- walk.
--
-- A post with a positive prediction is under 48 hours old, so its first
-- reading is at most 48 hours before. That is why the scan starts 48 hours
-- before p_since.
--
-- The result is one array instead of one row per post, because PostgREST cuts
-- results at 1,000 rows.
create function x_watch_best_scores(p_account text, p_since timestamptz)
returns table (history_from timestamptz, best_scores double precision[])
language sql
stable
as $$
  with scanned as (
    select tweet_id, walked_at, views_to_come
    from x_watch_feed_views
    where x_account = p_account and walked_at >= p_since - interval '48 hours'
  ),
  posts as (
    select min(walked_at) as first_seen, max(views_to_come) as score
    from scanned
    group by tweet_id
  ),
  bounds as (
    select min(walked_at) as first_walk, greatest(p_since, min(walked_at)) as history_from
    from scanned
  )
  select
    case when b.first_walk is null then null else b.history_from end,
    coalesce(
      (select array_agg(p.score order by p.score desc)
       from posts p
       where p.first_seen > b.first_walk and p.first_seen >= b.history_from and p.score > 0),
      '{}')
  from bounds b;
$$;

revoke execute on function x_watch_best_scores(text, timestamptz) from public, anon, authenticated;
grant execute on function x_watch_best_scores(text, timestamptz) to service_role;

notify pgrst, 'reload schema';
