-- A miniature of production for migration 156: migration 155's miniature with
-- 155 applied, and one leaderboard note an admin marked as posted on the old
-- website after 153, which wrote only posted_at.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/156_drop_review_sections.fixture.sql
--   $PSQL --single-transaction -f migrations/156_drop_review_sections.sql
--   $PSQL -f migrations/156_drop_review_sections.verify.sql
\ir 155_x_post_status.fixture.sql
\ir 155_x_post_status.sql

update everything_best_notes set posted_at = now()
 where note_id = (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d2');
