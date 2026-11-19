-- Checks for migration 193, run after it against 193_note_corrections.fixture.sql
-- (the commands are at the top of the fixture). Every value should be true.
create temp table result (name text, ok boolean);
grant all on result to anon, authenticated;

-- A signed-in reader who is not an admin cannot add a correction.
set role authenticated;
do $$
begin
  insert into everything_note_corrections (note_id, evidence_url) values ('00000000-0000-0000-0000-000000000001', 'https://x.com/a/status/1');
  insert into result values ('reader_cannot_add', false);
exception when insufficient_privilege then
  insert into result values ('reader_cannot_add', true);
end $$;
reset role;

-- An admin adds corrections. One without a link, or with a link that is not
-- https, is refused.
set test.admin = 'true';
set role authenticated;
insert into everything_note_corrections (note_id, evidence_url) values
  ('00000000-0000-0000-0000-000000000001', 'https://x.com/a/status/1'),
  ('00000000-0000-0000-0000-000000000002', 'https://x.com/a/status/2'),
  ('00000000-0000-0000-0000-000000000003', 'https://x.com/a/status/3'),
  ('00000000-0000-0000-0000-000000000004', 'https://x.com/a/status/4'),
  ('00000000-0000-0000-0000-000000000005', 'https://x.com/a/status/5');
do $$
begin
  insert into everything_note_corrections (note_id, evidence_url) values ('00000000-0000-0000-0000-000000000001', 'javascript:alert(1)');
  insert into result values ('bad_link_refused', false);
exception when check_violation or unique_violation then
  insert into result values ('bad_link_refused', sqlstate = '23514');
end $$;
reset role;
reset test.admin;

-- Give the rows known times: note 1 oldest, note 5 newest.
update everything_note_corrections set corrected_at = '2026-11-01'::timestamptz + (right(note_id::text, 1)::int || ' days')::interval;

-- Anyone reads the page: newest first, without the hidden note (3) and the
-- note without a claim (4).
set role anon;
insert into result select 'anon_reads_page', array_agg(right(note_id::text, 1) order by ord) = '{5,2,1}'
  from everything_corrections_page() with ordinality as p(note_id, evidence_url, corrected_at, ord);
insert into result select 'page_carries_link', bool_and(evidence_url like 'https://x.com/a/status/%') from everything_corrections_page();
-- The second page starts after the first page's last row.
insert into result select 'second_page', array_agg(right(note_id::text, 1) order by ord) = '{2,1}'
  from everything_corrections_page('2026-11-06', '00000000-0000-0000-0000-000000000005', 30) with ordinality as p(note_id, evidence_url, corrected_at, ord);
insert into result select 'limit_holds', count(*) = 1 from everything_corrections_page(null, null, 1);
reset role;

-- A signed-in reader who is not an admin cannot take one off.
set role authenticated;
delete from everything_note_corrections;
insert into result select 'reader_cannot_remove', count(*) = 5 from everything_note_corrections;
reset role;

-- An admin takes one off.
set test.admin = 'true';
set role authenticated;
delete from everything_note_corrections where note_id = '00000000-0000-0000-0000-000000000002';
reset role;
reset test.admin;
insert into result select 'admin_removes', count(*) = 4 from everything_note_corrections;

-- A deleted note leaves the list.
delete from everything_notes where id = '00000000-0000-0000-0000-000000000001';
insert into result select 'deleted_note_leaves', count(*) = 3 from everything_note_corrections;

select * from result;
