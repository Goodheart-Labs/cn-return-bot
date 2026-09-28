-- Migration 094's miniature of production, plus the feed_url column that
-- migration 086 added in production and 094's fixture leaves out. Migration
-- 094 itself runs first, because 105 replaces its function.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/105_project_avatars.fixture.sql
--   $PSQL --single-transaction -f migrations/105_project_avatars.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/105_project_avatars.verify.sql
--   sudo docker stop cn-migration-test
\ir 094_projects_by_votes.fixture.sql
\ir 094_projects_by_votes.sql
alter table everything_projects add column feed_url text;
update everything_projects set feed_url = 'https://zed.substack.com' where slug = 'zed';
