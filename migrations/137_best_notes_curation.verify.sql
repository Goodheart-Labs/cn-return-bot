-- Checks for migration 137, run on a fresh 136_best_notes.fixture.sql after
-- migrations 136 and 137. Every value should be true.
--
--   $PSQL -f migrations/136_best_notes.fixture.sql
--   $PSQL --single-transaction -f migrations/136_best_notes.sql
--   $PSQL --single-transaction -f migrations/137_best_notes_curation.sql
--   $PSQL -f migrations/137_best_notes_curation.verify.sql
create temp table result (name text, ok boolean);
grant all on result to anon, authenticated;

-- The job adds two recommendations with the service key.
set role service_role;
insert into everything_note_recommendations (note_id, position) values
  ('00000000-0000-0000-0000-000000000001', 1), ('00000000-0000-0000-0000-000000000002', 2);
reset role;

-- Readers see neither list.
set role anon;
insert into result select 'anon_cannot_read', not has_table_privilege('anon', 'everything_note_recommendations', 'select');
reset role;
set role authenticated;
insert into result select 'reader_sees_no_recommendations', count(*) = 0 from everything_note_recommendations;
reset role;

-- An admin comments, moves note 1 to the leaderboard and removes note 2 with a reason.
set test.admin = 'true';
set role authenticated;
update everything_note_recommendations set comment = 'strong number error' where note_id = '00000000-0000-0000-0000-000000000001';
select everything_move_to_leaderboard('00000000-0000-0000-0000-000000000001', 1);
update everything_note_recommendations set removed_at = now(), removed_reason = 'pedantic' where note_id = '00000000-0000-0000-0000-000000000002';
insert into result select 'moved_with_comment', count(*) = 1 from everything_best_notes where note_id = '00000000-0000-0000-0000-000000000001' and comment = 'strong number error';
insert into result select 'recommendation_marked_moved', moved_at is not null from everything_note_recommendations where note_id = '00000000-0000-0000-0000-000000000001';
insert into result select 'removal_keeps_reason', removed_reason = 'pedantic' from everything_note_recommendations where note_id = '00000000-0000-0000-0000-000000000002';
reset role;

-- Moving it again fails, and returning it makes it a recommendation again.
set role authenticated;
do $$ begin
  perform everything_move_to_leaderboard('00000000-0000-0000-0000-000000000001', 2);
  insert into result values ('second_move_refused', false);
exception when others then
  insert into result values ('second_move_refused', true);
end $$;
select everything_return_to_recommendations('00000000-0000-0000-0000-000000000001');
insert into result select 'returned', (select count(*) from everything_best_notes) = 0
  and (select moved_at is null from everything_note_recommendations where note_id = '00000000-0000-0000-0000-000000000001');
reset role;
reset test.admin;

-- A reader cannot move anything.
set role authenticated;
do $$ begin
  perform everything_move_to_leaderboard('00000000-0000-0000-0000-000000000001', 1);
  insert into result values ('reader_cannot_move', false);
exception when others then
  insert into result values ('reader_cannot_move', true);
end $$;
reset role;

select * from result;
