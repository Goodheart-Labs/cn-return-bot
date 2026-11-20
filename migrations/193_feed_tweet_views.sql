-- The feed view recorder (GOO-834). The daemon cn-feed-views on the services
-- box (src/feed-views/main.ts) reads the small, large and XL tiers of X's
-- eligible-posts feed every 10 minutes. Each such read of all three tiers is a
-- walk. For every post in XL it stores one reading of its public counts, so
-- that we can see how a post's views grow over time and learn to predict them.
--
-- This is a one-time collection of at most 14 days, about 1.5 GB. After that
-- the table either keeps only the last 3 days for production use, or it is
-- dropped. The training data is kept as an export on the devbox.
--
-- Only the service role writes and reads these tables, so the anon and
-- authenticated roles get nothing.

-- One row per post per walk. The table is narrow on purpose: about 900,000 rows
-- a day. tweet_id is a bigint here, although feed_tweets keeps it as text,
-- because 8 bytes instead of about 20 matter at that count. A join casts it.
create table feed_tweet_views (
  tweet_id bigint not null,
  -- When the XL page holding the post came back.
  observed_at timestamptz not null,
  impressions bigint,
  likes integer,
  retweets integer,
  replies integer,
  quotes integer,
  bookmarks integer,
  -- The smallest tier the post was in during this walk.
  tier text not null check (tier in ('small', 'large', 'xl')),
  -- The post's position in X's order of the XL list, starting at 1.
  xl_rank smallint not null,
  primary key (tweet_id, observed_at)
);

-- The rows arrive in time order, so a BRIN index serves reads by time window,
-- such as the daily export, at almost no cost. It stores only the range of
-- observed_at in each block of the table.
create index feed_tweet_views_observed_at on feed_tweet_views using brin (observed_at);

-- One row per walk. A post that is missing from a complete walk has left the
-- feed. A walk that is not complete says why it stopped.
create table feed_view_walks (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  complete boolean not null,
  stop_reason text,
  small_posts integer not null,
  large_posts integer not null,
  xl_posts integer not null,
  -- The requests the walk made.
  pages smallint not null,
  -- How many requests X said were left in its 15-minute window after the
  -- walk's last page. Null when no page came back.
  rate_remaining smallint,
  check (complete = (stop_reason is null))
);

create index feed_view_walks_complete_started on feed_view_walks (started_at desc) where complete;

alter table feed_tweet_views enable row level security;
alter table feed_view_walks enable row level security;
revoke all on feed_tweet_views from anon, authenticated;
revoke all on feed_view_walks from anon, authenticated;

notify pgrst, 'reload schema';
