-- Creators-by-visits leaderboard for the analytics dashboard (GOO-60). The
-- anon key cannot read everything_link_visits, so the dashboard reads through
-- this security-definer function, which returns only aggregate counts per
-- creator, the same pattern as everything_funnel.
--
-- A visit is attributed to a creator by the best name available: the visited
-- item's project name when the page is ingested, else the followed feed's
-- project name matched on the visit's captured feed URL, else the feed URL or
-- the page's hostname stripped of scheme and www. Old Substack rows without a
-- captured feed URL still attribute through the hostname derivation, the same
-- one everything_visit_counts uses.

create or replace function everything_creator_visits(window_days int default null)
returns table (creator text, visits bigint)
language sql
stable
security definer
set search_path = public
as $$
  with visit as (
    select
      v.item_id,
      v.url,
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url
    from everything_link_visits v
    where window_days is null or v.visited_at >= now() - make_interval(days => window_days)
  )
  select
    coalesce(
      item_project.name,
      feed_project.name,
      case
        when visit.feed_url is not null then regexp_replace(visit.feed_url, '^https?://(www\.)?', '')
        else regexp_replace(visit.url, '^https?://(www\.)?([^/]+).*$', '\2')
      end
    ) as creator,
    count(*) as visits
  from visit
  left join everything_items i on i.id = visit.item_id
  left join everything_projects item_project on item_project.id = i.project_id
  left join everything_followed_feeds f
    on visit.feed_url is not null
   and lower(regexp_replace(f.feed_url, '/+$', '')) = lower(visit.feed_url)
  left join everything_projects feed_project on feed_project.slug = f.project_slug
  group by 1
  order by visits desc, creator
$$;

revoke all on function everything_creator_visits(int) from public;
grant execute on function everything_creator_visits(int) to anon, authenticated;
