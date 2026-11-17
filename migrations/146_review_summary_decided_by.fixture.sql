-- A miniature of production for migration 146: migration 145's miniature with
-- 145 applied.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/146_review_summary_decided_by.fixture.sql
--   $PSQL --single-transaction -f migrations/146_review_summary_decided_by.sql
--   $PSQL -f migrations/146_review_summary_decided_by.verify.sql
\ir 145_no_approval_step.fixture.sql
\ir 145_no_approval_step.sql
