-- Checks for migration 130, run after it against 130_best_notes.fixture.sql
-- (the commands are at the top of the fixture). Every value should be true.
create temp table result (name text, ok boolean);
grant all on result to anon, authenticated;

-- The job writes with the service key.
set role service_role;
insert into everything_best_notes (note_id, position) values
  ('00000000-0000-0000-0000-000000000001', 1), ('00000000-0000-0000-0000-000000000002', 2);
reset role;

-- A signed-in reader can read the list but not change it.
set role authenticated;
insert into result select 'reader_reads', count(*) = 2 from everything_best_notes;
update everything_best_notes set position = 0 where note_id = '00000000-0000-0000-0000-000000000002';
delete from everything_best_notes;
insert into result select 'reader_cannot_change', array_agg(position order by position) = '{1,2}' from everything_best_notes;
reset role;

-- An admin moves the second note to the top, adds the third and removes the first.
set test.admin = 'true';
set role authenticated;
update everything_best_notes set position = 0.5 where note_id = '00000000-0000-0000-0000-000000000002';
insert into everything_best_notes (note_id, position) values ('00000000-0000-0000-0000-000000000003', 3);
delete from everything_best_notes where note_id = '00000000-0000-0000-0000-000000000001';
insert into result select 'admin_changes', array_agg(note_id order by position) =
  '{00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000003}'::uuid[] from everything_best_notes;
reset role;
reset test.admin;

-- A deleted note leaves the list.
delete from everything_notes where id = '00000000-0000-0000-0000-000000000003';
insert into result select 'deleted_note_leaves', count(*) = 1 from everything_best_notes;

set role anon;
insert into result select 'anon_reads', count(*) = 1 from everything_best_notes;
reset role;

select * from result;
