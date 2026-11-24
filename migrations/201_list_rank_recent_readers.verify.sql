-- Checks for migration 201. Run it after the migration. It changes nothing.
-- Every value should be true. Readers who came in since the last
-- notewriter_tidy_list can make readers_current false for up to 5 minutes.
with recent as (select * from everything_recent_page_readers())
select
  not exists (select 1 from everything_items i left join everything_projects p on p.id = i.project_id
               where i.list_open and i.list_rank <> coalesce(p.list_rank, 0) + i.list_readers) as rank_is_creator_plus_readers,
  not exists (select 1 from everything_items i left join recent r on r.page_url = everything_visit_page(i.url)
               where i.list_open and i.list_readers <> coalesce(r.readers, 0)) as readers_current,
  not exists (select 1 from everything_items where not list_open and list_readers > 0) as unlisted_have_no_readers,
  (select count(*) from everything_items where list_open and list_readers > 0) as listed_posts_with_readers;
