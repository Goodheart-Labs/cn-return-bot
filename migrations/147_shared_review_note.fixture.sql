-- A miniature of production for migration 147: migration 146's miniature with
-- 146 applied, and an explanation Nathan gave for his Helpful vote on the open
-- note.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/147_shared_review_note.fixture.sql
--   $PSQL --single-transaction -f migrations/147_shared_review_note.sql
--   $PSQL -f migrations/147_shared_review_note.verify.sql
\ir 146_review_summary_decided_by.fixture.sql
\ir 146_review_summary_decided_by.sql

insert into everything_votes (note_id, voter_id, vote)
select note_id, '00000000-0000-0000-0000-00000000000b', 1 from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4';
insert into everything_claude_events (actor, type, draft_id, data)
values ('nathan', 'explained', '00000000-0000-0000-0000-0000000000d4', '{"text": "Real error", "vote": 1}');
