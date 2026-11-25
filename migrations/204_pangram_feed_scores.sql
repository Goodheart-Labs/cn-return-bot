-- The history of the first X account's Pangram pass (GOO-880). After every
-- walk of the feed, cn-feed-views sends the long-form posts whose predicted
-- views still to come clear a threshold to Pangram, an AI-text detector
-- (src/x-notes/pangram.ts). The threshold lets through just enough posts for
-- about 3 Pangram notes a day, judged by the long-form posts that arrived over
-- the last 7 days and the best prediction each one had
-- (src/pipeline/utils/viewsThreshold.ts).
--
-- Reading that history from feed_tweet_views took 33 seconds and 1.1 million
-- buffer reads on 2026-11-25, far too much for every hour. So the daemon keeps
-- one row per long-form post here and updates it only when a walk gives the
-- post a better prediction than before. About 580 long-form posts arrive a
-- day. A long-form post has more than 280 characters, the limit of a free
-- account, or is an X Article.
--
-- Only the service role writes and reads this table, so the anon and
-- authenticated roles get nothing.

create table pangram_feed_scores (
  tweet_id text primary key,
  -- When the daemon first saw the post with a positive prediction.
  first_seen_at timestamptz not null,
  best_views_to_come real not null check (best_views_to_come > 0)
);

-- The daemon reads the last 7 days of rows at its start.
create index pangram_feed_scores_first_seen on pangram_feed_scores (first_seen_at);

alter table pangram_feed_scores enable row level security;
revoke all on pangram_feed_scores from anon, authenticated;

-- The last 7 days, read once from the readings, so the threshold is set from
-- the first walk on. This is the 33-second read from above, run only here.
insert into pangram_feed_scores (tweet_id, first_seen_at, best_views_to_come)
select ft.tweet_id, ft.first_seen_at, best.views_to_come
from feed_tweets ft
cross join lateral (
  select max(v.views_to_come) as views_to_come
  from feed_tweet_views v
  where v.tweet_id = ft.tweet_id::bigint
) best
where ft.first_seen_at >= now() - interval '7 days'
  and (length(ft.text) > 280 or ft.raw_tweet ? 'article')
  and coalesce(ft.raw_tweet ->> 'possibly_sensitive', 'false') <> 'true'
  and best.views_to_come > 0;

notify pgrst, 'reload schema';
