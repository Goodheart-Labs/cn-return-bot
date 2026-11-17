-- A miniature of production for migration 152: migration 151's miniature with
-- 151 applied. Its two drafts saved as 'awaiting_approval' become 'posting'.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/152_drop_approval_setting.fixture.sql
--   $PSQL --single-transaction -f migrations/152_drop_approval_setting.sql
--   $PSQL -f migrations/152_drop_approval_setting.verify.sql
\ir 151_disagreement_is_no_decision.fixture.sql
\ir 151_disagreement_is_no_decision.sql
