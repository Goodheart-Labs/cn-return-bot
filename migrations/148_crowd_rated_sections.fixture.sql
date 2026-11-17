-- A miniature of production for migration 148: migration 147's miniature with
-- 147 applied.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/148_crowd_rated_sections.fixture.sql
--   $PSQL --single-transaction -f migrations/148_crowd_rated_sections.sql
--   $PSQL -f migrations/148_crowd_rated_sections.verify.sql
\ir 147_shared_review_note.fixture.sql
\ir 147_shared_review_note.sql
