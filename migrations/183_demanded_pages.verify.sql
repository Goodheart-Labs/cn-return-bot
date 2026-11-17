-- Checks for migration 183. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'everything_demand_queued') as row_level_security_on,
  not has_table_privilege('anon', 'everything_demand_queued', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'everything_demand_queued', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'everything_demand_queued', 'insert') as service_role_can_write,
  not has_function_privilege('anon', 'everything_demanded_pages(int, int, int)', 'execute') as anon_cannot_list,
  not has_function_privilege('anon', 'everything_demand_report()', 'execute') as anon_cannot_report,
  -- No page the rule lists has an item, was taken before, or is under its bar.
  not exists (
    select 1 from everything_demanded_pages(3, 5, 1000) d
     where exists (select 1 from everything_items i where everything_visit_page(i.url) = d.page_url)
        or exists (select 1 from everything_demand_queued q where q.page_url = d.page_url)
        or d.readers < case d.kind when 'text' then 3 else 5 end
        or d.kind is null
  ) as lists_only_new_pages_over_the_bar,
  -- A null bar switches that kind off.
  not exists (select 1 from everything_demanded_pages(null, 5, 1000) where kind = 'text') as text_off_lists_no_text,
  not exists (select 1 from everything_demanded_pages(3, null, 1000) where kind = 'youtube') as youtube_off_lists_no_videos;
