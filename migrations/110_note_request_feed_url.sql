-- A note request names the creator of the requested page (GOO-290).
--
-- The request consumer used to put every newly requested page under the
-- catch-all "Around the web" project. A post on a creator's Substack, a video
-- on their YouTube channel, or their LessWrong post should go to that creator's
-- project instead. The extension already works out a page's creator for its
-- follow button, including a Substack newsletter on a custom domain, which only
-- the page itself can reveal. It now sends that creator's feed URL with the
-- request, and the consumer files the page under the matching project.
--
-- The value comes from an anonymous client, so the consumer trusts it only when
-- it parses as a creator feed (canonicalFeed in src/everything/feedUrls.ts).
-- The check below only keeps junk out of the column. The existing insert
-- policy names no columns, so clients may set this one without a policy change.
--
-- Every existing row gets null, which means "the request did not say".

alter table everything_note_requests
  add column feed_url text check (feed_url is null or (feed_url ~* '^https://' and char_length(feed_url) <= 500));

comment on column everything_note_requests.feed_url is
  'Feed URL of the creator the requested page belongs to, as the extension worked it out. Null when the page has no creator or the client did not say.';
