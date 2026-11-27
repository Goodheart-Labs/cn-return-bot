-- Checks for migration 209. It reads only and can run on production after the
-- migration. It reads the whole visits table once, for comparison, so it takes
-- a few seconds. Every value should be true.
with listed as (
  select * from everything_recent_posts(10, null, null, 100)
),
every_page as (
  select regexp_replace(v.page_url, '/comments$', '') as page_url,
         count(distinct v.reader_hash) as readers,
         count(*) as visits
  from everything_link_visits v
  group by 1
),
counted as (
  select l.readers, l.visits,
         coalesce(e.readers, 0) as expected_readers,
         coalesce(e.visits, 0) as expected_visits
  from listed l
  left join every_page e on e.page_url = everything_visit_page(l.url)
)
select
  (select count(*) = 100 from listed) as lists_a_full_page,
  (select bool_and(readers = expected_readers and visits = expected_visits) from counted) as counts_match_a_full_scan,
  (select bool_and(readers <= visits) from counted) as readers_never_exceed_visits,
  has_function_privilege('anon', 'everything_recent_posts(int,timestamptz,uuid,int)', 'execute') as anon_can_read_dashboard,
  exists (select 1 from pg_indexes where indexname = 'everything_link_visits_page_url_idx') as page_index_exists;
