-- Each creator's visit numbers as the daily refresh at 03:23 UTC saw them,
-- from visits before that moment only: the average different readers per
-- post over their 10 most recently visited posts, and how many posts.
with cut as (
  select d + interval '3 hours 23 minutes' as at
    from generate_series(timestamptz '2026-11-01', timestamptz '2026-11-23', interval '1 day') d
), post as (
  select c.at, lower(rtrim(v.feed_url, '/')) as creator, v.page_url,
         count(distinct v.reader_hash) as readers, max(v.visited_at) as last_visit
    from cut c join everything_link_visits v on v.visited_at < c.at
   where v.reader_hash is not null and v.feed_url is not null
   group by 1, 2, 3
), ranked as (
  select *, row_number() over (partition by at, creator order by last_visit desc, page_url) as place from post
)
select at, creator, avg(readers)::float8 as visitors_per_post, count(*)::int as posts
  from ranked where place <= 10 group by 1, 2;
