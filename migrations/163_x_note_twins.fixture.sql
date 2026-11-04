-- A miniature of production for migration 163: migration 159's miniature with
-- 159 applied, plus the two types the feed's functions take.
--
--   sudo docker run -d --rm --name cn-migration-test-163 -e POSTGRES_PASSWORD=test -p 55463:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55463 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/163_x_note_twins.fixture.sql
--   $PSQL --single-transaction -f migrations/163_x_note_twins.sql
--   $PSQL -f migrations/163_x_note_twins.verify.sql
--
-- 159's notes n1 to n4 were submitted and n5 was not, so the backfill makes
-- four twins. 159's own verify file now fails its commonnotes_summary check,
-- because it counts every note, twins included.
\ir 159_notewriter_dashboards.fixture.sql
\ir 159_notewriter_dashboards.sql

create type everything_feed_scope as (
  project_id uuid, item_id uuid, min_views int, min_votes int, min_helpful int, min_not_helpful int,
  unvoted_only boolean, voted_before timestamptz
);
