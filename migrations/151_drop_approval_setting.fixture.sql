-- A miniature of production for migration 151: migration 150's miniature with
-- 150 applied. Its two drafts saved as 'awaiting_approval' become 'posting'.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/151_drop_approval_setting.fixture.sql
--   $PSQL --single-transaction -f migrations/151_drop_approval_setting.sql
--   $PSQL -f migrations/151_drop_approval_setting.verify.sql
\ir 150_somewhat_is_no_decision.fixture.sql
\ir 150_somewhat_is_no_decision.sql
