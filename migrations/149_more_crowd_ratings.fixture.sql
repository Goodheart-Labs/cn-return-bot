-- A miniature of production for migration 149: migration 148's miniature with
-- 148 applied.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/149_more_crowd_ratings.fixture.sql
--   $PSQL --single-transaction -f migrations/149_more_crowd_ratings.sql
--   $PSQL -f migrations/149_more_crowd_ratings.verify.sql
\ir 148_crowd_rated_sections.fixture.sql
\ir 148_crowd_rated_sections.sql
