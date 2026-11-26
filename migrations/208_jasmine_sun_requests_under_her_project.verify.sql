-- Checks for migration 208. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select count(*) = 5 from everything_items i join everything_projects p on p.id = i.project_id
   where p.feed_url = 'https://jasmine.substack.com') as five_posts_under_her_project,
  not exists (select 1 from everything_items where url like 'https://substack.com/@jasmine/%') as no_reader_addresses_left,
  (select count(*) = 1 from everything_items where url = 'https://jasmi.news/p/no-data-centers-in-my-backyard') as one_item_per_post;
