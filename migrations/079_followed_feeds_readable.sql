-- The extension's follow button must hide only when a feed is genuinely
-- followed. Its old proxy, "we have ingested a page by this author", broke the
-- moment readers could request single pages: one requested post hid the follow
-- button for its author for good. So clients get to read the followed list
-- itself. They may read the feed URLs and nothing else; the other columns stay
-- service-key only.

grant select (feed_url) on everything_followed_feeds to anon, authenticated;

create policy followed_feeds_select on everything_followed_feeds
  for select to anon, authenticated
  using (true);
