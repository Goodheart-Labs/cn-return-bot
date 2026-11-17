-- A miniature of production for migration 144: migration 143's miniature with
-- 143 applied, the stored vote total of migration 141, and a stand-in for the
-- view counts of migration 141 that says the fixture's post was shown on 7
-- devices.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/144_review_note_filters.fixture.sql
--   $PSQL --single-transaction -f migrations/144_review_note_filters.sql
--   $PSQL -f migrations/144_review_note_filters.verify.sql
\ir 143_review_by_vote.fixture.sql
\ir 143_review_by_vote.sql

alter table everything_notes add column feed_votes int not null default 0;
create type everything_item_views as (item_ids uuid[], viewers bigint[]);
create function everything_item_views() returns everything_item_views
language sql stable as $$
  select row(array['00000000-0000-0000-0000-0000000000e1'::uuid], array[7::bigint])::everything_item_views
$$;
