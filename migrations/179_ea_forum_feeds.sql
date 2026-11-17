-- EA Forum authors as creators (GOO-745).
--
-- The EA Forum runs ForumMagnum, the same forum software as LessWrong and the
-- Alignment Forum, and the pipeline reads its authors the same way. An EA
-- Forum author's feed is their profile page,
-- https://forum.effectivealtruism.org/users/<slug>, without www.
--
-- everything_feed_slug() decides which feed URLs a project may store: the
-- shape CHECK on everything_projects.feed_url (migration 086) and
-- everything_creator_project() (migration 111) both call it. Until now it
-- accepted author pages on www.lesswrong.com and www.alignmentforum.org only,
-- so no EA Forum creator could be stored. This adds the EA Forum and changes
-- nothing else. It mirrors canonicalFeed() in src/everything/feedUrls.ts.
--
-- The EA Forum's accounts are its own, unlike LessWrong's and the Alignment
-- Forum's. An EA Forum author whose slug is taken by another creator gets the
-- next free slug, as any second creator with the same handle does, because
-- projects are matched by their feed URL.
--
-- Every stored feed URL is still accepted, so the CHECK stays valid without a
-- rewrite of the table.

create or replace function everything_feed_slug(feed_url text)
returns text
language sql
immutable
as $$
  select case
    when feed_url ~ '^https://(?!www\.)[\w-]+\.substack\.com$'
      then lower((regexp_match(feed_url, '^https://([\w-]+)\.substack\.com$'))[1])
    when feed_url ~ '^https://www\.youtube\.com/@[\w.-]+$'
      then lower((regexp_match(feed_url, '/@([\w.-]+)$'))[1])
    when feed_url ~ '^https://www\.youtube\.com/channel/[\w-]+$'
      then lower((regexp_match(feed_url, '/channel/([\w-]+)$'))[1])
    when feed_url ~ '^https://(www\.lesswrong\.com|www\.alignmentforum\.org|forum\.effectivealtruism\.org)/users/[\w.-]+$'
      then lower((regexp_match(feed_url, '/users/([\w.-]+)$'))[1])
  end
$$;
