-- Capture the complete raw X-API tweet object on every new tweet.
--
-- fetchEligiblePosts now requests every field the endpoint exposes (except the
-- owner-only metrics that 403 on other people's posts) and parsePostsResponse
-- attaches a self-contained `raw` object (the data[] tweet plus its resolved
-- media / author / referenced-tweet / poll / place expansions). We store it
-- verbatim so no field is ever lost — anything that becomes useful later can be
-- promoted to a typed column without re-fetching.
--
-- Insert-only path (bulkInsertNewTweets skips existing tweet_ids), so this is
-- populated only for tweets first seen after deploy; historical rows stay NULL.

ALTER TABLE tweets ADD COLUMN IF NOT EXISTS raw_tweet JSONB;
