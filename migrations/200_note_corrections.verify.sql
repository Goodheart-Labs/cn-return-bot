-- Checks for migration 200, run after it against 200_note_corrections.fixture.sql
-- (the commands are at the top of the fixture). Every value should be true.
create temp table result (name text, ok boolean);
grant all on result to anon, authenticated, service_role;

-- The claim corrected by hand before this migration got its date.
insert into result select 'old_correction_dated', quote_updated_at = '2026-07-14'
  from everything_claims where id = '00000000-0000-0000-0000-0000000000c6';

-- A signed-in reader who is not an admin cannot add a correction, and cannot
-- ask which passages the daily job reads.
set role authenticated;
do $$
begin
  insert into everything_note_corrections (note_id, evidence_url) values ('00000000-0000-0000-0000-000000000001', 'https://x.com/a/status/1');
  insert into result values ('reader_cannot_add', false);
exception when insufficient_privilege then
  insert into result values ('reader_cannot_add', true);
end $$;
do $$
begin
  perform everything_quote_check_candidates();
  insert into result values ('reader_cannot_list_candidates', false);
exception when insufficient_privilege then
  insert into result values ('reader_cannot_list_candidates', true);
end $$;
reset role;

-- An admin adds corrections. One with a link that is not https is refused.
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
  insert into everything_note_corrections (note_id, evidence_url) values ('00000000-0000-0000-0000-000000000006', 'javascript:alert(1)');
  insert into result values ('bad_link_refused', false);
exception when check_violation then
  insert into result values ('bad_link_refused', true);
end $$;
reset role;
reset test.admin;

-- Give the rows known times: note 1 on 2 November, note 5 on 6 November.
update everything_note_corrections set corrected_at = '2026-11-01'::timestamptz + (right(note_id::text, 1)::int || ' days')::interval;

-- The daily job reads the passages on text posts that a visible note with a
-- Helpful vote quotes: not the hidden note's (3), the one already corrected
-- (6), the video's (8) or the one without a Helpful vote (9).
set role service_role;
insert into result select 'candidates', array_agg(right(claim_id::text, 1) order by claim_id) = '{1,2,5,7}' from everything_quote_check_candidates();

-- It finds three changed, and each gets its date.
update everything_claims set updated_quote = 'as it reads now' where right(id::text, 1) in ('1', '2', '7');
insert into result select 'change_is_dated', count(*) = 3 from everything_claims where right(id::text, 1) in ('1', '2', '7') and quote_updated_at is not null;
reset role;
update everything_claims set quote_updated_at = '2026-11-10' where id = '00000000-0000-0000-0000-0000000000c2';

-- An admin clears one the job got wrong. The job never reads it again.
update everything_claims set updated_quote = null where id = '00000000-0000-0000-0000-0000000000c1';
set role service_role;
insert into result select 'cleared_is_not_read_again', array_agg(right(claim_id::text, 1) order by claim_id) = '{5}' from everything_quote_check_candidates();
reset role;

-- Anyone reads the page, newest first: the admin's rows for notes 5, 2 and 1,
-- then note 6, whose post changed in July. Note 2's post changed too, but its
-- admin row with the evidence wins. Left out: the hidden note (3), the note
-- without a claim (4) and the note rated not helpful (7).
set role anon;
insert into result select 'anon_reads_page', array_agg(right(note_id::text, 1) order by ord) = '{5,2,1,6}'
  from everything_corrections_page() with ordinality as p(note_id, evidence_url, corrected_at, ord);
insert into result select 'only_found_changes_lack_a_link', array_agg(right(note_id::text, 1)) = '{6}' from everything_corrections_page() where evidence_url is null;
-- The second page starts after the first page's last row.
insert into result select 'second_page', array_agg(right(note_id::text, 1) order by ord) = '{2,1,6}'
  from everything_corrections_page('2026-11-06', '00000000-0000-0000-0000-000000000005', 30) with ordinality as p(note_id, evidence_url, corrected_at, ord);
insert into result select 'limit_holds', count(*) = 1 from everything_corrections_page(null, null, 1);
reset role;

-- A signed-in reader who is not an admin cannot read the table or take a row off.
set role authenticated;
delete from everything_note_corrections;
insert into result select 'reader_cannot_read_table', count(*) = 0 from everything_note_corrections;
reset role;
insert into result select 'reader_cannot_remove', count(*) = 5 from everything_note_corrections;

-- An admin takes note 2's row off. The note stays on the page, now as a
-- change we found, at the date we found it.
set test.admin = 'true';
set role authenticated;
delete from everything_note_corrections where note_id = '00000000-0000-0000-0000-000000000002';
reset role;
reset test.admin;
insert into result select 'found_change_shows_without_a_row', array_agg(right(note_id::text, 1) order by ord) = '{2,5,1,6}'
  from everything_corrections_page() with ordinality as p(note_id, evidence_url, corrected_at, ord);

-- A deleted note leaves the list.
delete from everything_notes where id = '00000000-0000-0000-0000-000000000001';
insert into result select 'deleted_note_leaves', count(*) = 3 from everything_note_corrections;

select * from result;
