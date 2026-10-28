-- A miniature of production for migration 154: migration 153's miniature with
-- 153 applied, and one leaderboard note an admin marked as posted on the old
-- website after 153, which wrote only posted_at.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/154_drop_review_sections.fixture.sql
--   $PSQL --single-transaction -f migrations/154_drop_review_sections.sql
--   $PSQL -f migrations/154_drop_review_sections.verify.sql
\ir 153_review_fields.fixture.sql
\ir 153_review_fields.sql

update everything_best_notes set posted_at = now()
 where note_id = (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d2');
