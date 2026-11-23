-- Checks for migration 199. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  not has_function_privilege('anon', 'everything_demanded_listed(int, int, int)', 'execute') as anon_cannot_list,
  has_function_privilege('service_role', 'everything_demanded_listed(int, int, int)', 'execute') as service_role_can_list,
  -- Every post it lists is waiting, unchecked, not yet demanded or requested,
  -- not taken before, and over its bar.
  not exists (
    select 1 from everything_demanded_listed(2, 2, 1000) d
      join everything_items i on i.id = d.item_id
     where not i.list_open or i.status <> 'queued' or i.first_checked_at is not null
        or i.demanded_at is not null or i.list_requested or d.readers < 2
        or exists (select 1 from everything_demand_queued q where q.page_url = d.page_url)
  ) as lists_only_waiting_posts_over_the_bar,
  (select count(*) = count(distinct item_id) from everything_demanded_listed(2, 2, 1000)) as lists_each_post_once,
  -- A null bar switches that kind off.
  not exists (select 1 from everything_demanded_listed(null, 2, 1000) where kind = 'text') as text_off_lists_no_text,
  not exists (select 1 from everything_demanded_listed(2, null, 1000) where kind = 'youtube') as youtube_off_lists_no_videos;
