-- Checks for migration 128, run after it against 128_item_note_viewers.fixture.sql
-- (the commands are at the top of the fixture). Every value should be true.
with v as (select * from everything_item_note_viewers())
select
  (select viewers = 3 from v where item_id = 'p1') as p1_counts_readers_once_without_team,
  (select viewers = 1 from v where item_id = 'p2') as p2_ignores_other_events,
  not exists (select 1 from v where item_id = 'p3') as team_only_post_is_absent,
  (select count(*) = 2 from v) as two_posts,
  has_function_privilege('anon', 'everything_item_note_viewers()', 'execute') as anon_can_read_counts;
