-- Each reading's score (GOO-865): the views the post is predicted to get from
-- this reading until it is 48 hours old (src/pipeline/utils/viewsToCome.ts).
-- The feed daemon cn-feed-views computes it from the post's reading in the
-- walk before, 10 minutes earlier, and stores it with the reading. Its X note
-- writer picks tweets by it. It is null when the post was not in the walk
-- before, or a count was missing.
alter table feed_tweet_views add column views_to_come real;
