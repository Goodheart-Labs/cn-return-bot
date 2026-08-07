-- Freeze first-sight data on feed_tweets so per-tier arrival velocity can be
-- reconstructed later: velocity-at-arrival = first_seen_impressions over
-- (first_seen_at - posted_at). The existing `impressions` column is refreshed
-- whenever a capture run re-sees the tweet, so it can't serve as the arrival
-- value; these two columns are written once at first sight and never rewritten.
--
-- Populated by every regular pipeline run from now on (generateCandidates
-- archives each new post the feed ladder surfaces, below-floor posts included)
-- in addition to the manual capture-feed-tweets workflow.

ALTER TABLE feed_tweets
  ADD COLUMN IF NOT EXISTS first_seen_impressions BIGINT,
  ADD COLUMN IF NOT EXISTS first_seen_feed_size TEXT;

-- Backfill the single existing capture (2026-07-18, xxl feed): no capture has
-- re-run since, so `impressions` still holds the first-sight values.
UPDATE feed_tweets
SET first_seen_impressions = impressions,
    first_seen_feed_size = 'xxl'
WHERE first_seen_impressions IS NULL;
