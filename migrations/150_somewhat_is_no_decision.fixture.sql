-- A miniature of production for migration 150: migration 149's miniature with
-- 149 applied. In it Nathan voted Helpful on the open note (migration 147's
-- fixture); here he changes that vote to Somewhat helpful before 150 runs.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/150_somewhat_is_no_decision.fixture.sql
--   $PSQL --single-transaction -f migrations/150_somewhat_is_no_decision.sql
--   $PSQL -f migrations/150_somewhat_is_no_decision.verify.sql
\ir 149_more_crowd_ratings.fixture.sql
\ir 149_more_crowd_ratings.sql

update everything_votes set vote = 0
 where voter_id = '00000000-0000-0000-0000-00000000000b'
   and note_id = (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4');
