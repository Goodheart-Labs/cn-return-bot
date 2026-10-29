-- A miniature of production for migration 155: migration 154's miniature with
-- 154 applied.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/155_x_post_status.fixture.sql
--   $PSQL --single-transaction -f migrations/155_x_post_status.sql
--   $PSQL -f migrations/155_x_post_status.verify.sql
\ir 154_x_accounts_and_clicks.fixture.sql
\ir 154_x_accounts_and_clicks.sql
