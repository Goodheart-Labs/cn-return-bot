-- Each followed creator's most popular posts of all time (GOO-81). The daily
-- feed walk also offers these as enqueue candidates, behind the creator's
-- recent posts, so an evergreen hit gets fact-checked on days when the feeds
-- are otherwise caught up.
--
-- The table is a cache. Computing a top list live would cost a full channel
-- listing per YouTube creator and an archive API call per Substack publication
-- on every walk, so the walk refreshes at most one stale creator per run and
-- reads everyone else from here. Popularity is the platform's own signal:
-- YouTube view count, Substack like count.

create table everything_top_posts (
  id uuid primary key default gen_random_uuid(),
  feed_url text not null,
  source text not null check (source in ('substack', 'youtube')),
  url text not null,
  title text,
  published_at timestamptz,
  popularity bigint not null,
  rank int not null,
  unique (feed_url, url)
);

comment on table everything_top_posts is
  'Cache of each followed creator''s most popular posts of all time (GOO-81). Refreshed by the auto-enqueue walk, one stale creator per run.';
comment on column everything_top_posts.feed_url is
  'The creator''s feed URL, the same form everything_followed_feeds stores.';
comment on column everything_top_posts.popularity is
  'The platform''s own popularity signal: view count for a YouTube video, like count for a Substack post.';
comment on column everything_top_posts.rank is
  '1-based position within the creator''s top list, most popular first.';

-- Only the pipeline's service key touches this table.
alter table everything_top_posts enable row level security;

-- The refresh stamp lives on the feed, not on the cached rows, because a
-- creator whose top list comes back empty (say, every liked post is paid)
-- still counts as refreshed. A stamp on the rows would make such a feed look
-- permanently stale and re-fetch on every run.
alter table everything_followed_feeds
  add column top_posts_refreshed_at timestamptz;

comment on column everything_followed_feeds.top_posts_refreshed_at is
  'When this creator''s everything_top_posts rows were last recomputed. Null means never.';
