-- 113: what the Trending Posts workflow needs to never post the same X post to
-- Slack twice (GOO-289).
--
-- Once a day, the workflow asks Grok for posts from yesterday and today that
-- went viral in Nathan Young's crowd and are about an article. The search
-- windows of two consecutive runs overlap by a day, so a post can come back on
-- the next run. This table remembers what was already posted.

create table trending_posts (
  post_id text primary key,
  topic text not null,
  posted_at timestamptz not null default now()
);

comment on table trending_posts is
  'One row per X post the Trending Posts workflow posted to Slack''s #trending-posts, so it never posts the same post twice (GOO-289). Service key only.';
comment on column trending_posts.post_id is 'The X post id, from the post''s address.';
comment on column trending_posts.topic is 'The crowd topic whose Slack message listed the post, such as "AI safety".';

-- No policies: only the service key, which bypasses row level security, can
-- read or write the table.
alter table trending_posts enable row level security;
