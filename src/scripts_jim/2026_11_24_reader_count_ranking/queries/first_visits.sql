-- For each page of a listable post: how many different readers first opened
-- it in each minute. No reader hash leaves the database.
with page as (
  select distinct everything_visit_page(i.url) as page
    from everything_items i
   where coalesce(i.demanded_at::date, i.published_at, i.created_at::date) >= date '2026-10-31'
      or i.created_at >= '2026-10-31'
      or i.id in (select item_id from everything_reservations where started_at >= '2026-11-14')
), first_visit as (
  select regexp_replace(v.page_url, '/comments$', '') as page, v.reader_hash, min(v.visited_at) as at
    from everything_link_visits v
   where v.reader_hash is not null
   group by 1, 2
)
select f.page, date_trunc('minute', f.at) as minute, count(*)::int as readers
  from first_visit f join page p on p.page = f.page
 group by 1, 2;
