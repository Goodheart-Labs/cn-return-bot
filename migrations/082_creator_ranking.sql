-- Creators are ranked by reader attention (GOO-60). The extension stamps each
-- link visit with the creator's feed URL, captured on the device at visit
-- time, because the server cannot derive a creator from a page URL alone: a
-- YouTube watch URL does not name its channel, and a custom-domain Substack
-- does not name its *.substack.com form. The auto-enqueue then walks creators
-- in attention order, and a manual flag can push a creator to the front for a
-- while.

alter table everything_link_visits
  add column feed_url text check (feed_url is null or char_length(feed_url) <= 2048);

comment on column everything_link_visits.feed_url is
  'The creator''s feed URL (https://<sub>.substack.com or a YouTube channel URL), captured on-device at visit time. Null when the page has no followable creator, for example on LessWrong. The row stays anonymous.';

-- The insert policy stays as it is: clients may insert rows, and feed_url is
-- just one more anonymous column on them.

alter table everything_followed_feeds
  add column priority_until timestamptz;

comment on column everything_followed_feeds.priority_until is
  'While this lies in the future, the feed''s creator ranks strictly above every unflagged creator. Set by the everything-prioritize script, seven days at a time.';

-- Visit counts per creator over a window, summed in the database so the
-- PostgREST row cap can never undercount (same pattern as
-- everything_cost_since). Old rows carry no feed_url; the ones whose URL is a
-- *.substack.com post still count, because the publication is derivable from
-- the hostname. Old YouTube and custom-domain rows are left out and the
-- window fills itself with stamped rows.
create or replace function everything_visit_counts(since timestamptz)
returns table (feed_url text, visits bigint)
language sql
stable
as $$
  select s.feed_url, count(*) as visits
  from (
    select coalesce(
      nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
      case
        when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
        then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
      end
    ) as feed_url
    from everything_link_visits v
    where v.visited_at >= since
  ) s
  where s.feed_url is not null
  group by s.feed_url;
$$;

revoke execute on function everything_visit_counts(timestamptz) from public, anon, authenticated;
grant execute on function everything_visit_counts(timestamptz) to service_role;
