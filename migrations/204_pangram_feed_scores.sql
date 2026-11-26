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
-- post a better prediction than before. The threshold depends only on the best
-- few hundred scores of the week, so a post is stored only once its score
-- reaches half of the last threshold. The walk reads XL and part of XXL, so
-- many thousands of long-form posts arrive a day, about 580 of them in XL. A
-- long-form post has more than 280 characters, the limit of a free account, or
-- is an X Article.
--
-- The table starts empty. It was applied on 2026-11-26 while cn-feed-views
-- was dormant, because X had paused the first account. A backfill from
-- feed_tweet_views would be stale by the time the daemon runs again, and its
-- gap of days without readings would make the history undercount how many
-- posts arrive. So the pass sets no threshold for its first 3 hours.
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

notify pgrst, 'reload schema';
