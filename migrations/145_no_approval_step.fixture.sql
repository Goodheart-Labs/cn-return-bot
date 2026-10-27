-- A miniature of production for migration 145: migration 144's miniature with
-- 143 and 144 applied. Its two drafts that wait for approval stand for notes
-- whose posting has not finished.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/145_no_approval_step.fixture.sql
--   $PSQL --single-transaction -f migrations/145_no_approval_step.sql
--   $PSQL -f migrations/145_no_approval_step.verify.sql
\ir 144_review_note_filters.fixture.sql
\ir 144_review_note_filters.sql
