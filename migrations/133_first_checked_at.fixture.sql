-- A miniature of production for testing migration 133 (GOO-549): migration
-- 132's fixture, migration 132 itself, and the tables the backfill reads.
--   sudo docker run --rm -d --name pg133 -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   for f in 132_ranking_score_and_delay.fixture.sql 132_ranking_score_and_delay.sql 133_first_checked_at.fixture.sql 133_first_checked_at.sql 133_first_checked_at.verify.sql; do
--     PGPASSWORD=test psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 --single-transaction -f migrations/$f; done

create table everything_pipeline_runs (item_id uuid, kind text, created_at timestamptz);
create table everything_claude_events (item_id uuid, type text, at timestamptz);

-- A post the pipeline checked on 21 October, which Claude finished again on
-- 22 and 23 October, the way "Against Against Handover" went.
insert into everything_items (id, project_id, url, status, checked_scope, priority, published_at, published_time, created_at, processed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/rechecked', 'done', 'page', 1,
   '2026-10-20', '2026-10-20 20:32Z', '2026-10-21 05:27Z', '2026-10-23 08:09Z');
insert into everything_pipeline_runs values
  ('00000000-0000-0000-0000-0000000000a1', 'extraction', '2026-10-21 05:28Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'rating', '2026-10-21 05:30Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'other', '2026-10-22 11:00Z');
insert into everything_claude_events values
  ('00000000-0000-0000-0000-0000000000a1', 'item_finished', '2026-10-22 11:34Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'item_finished', '2026-10-23 08:09Z');
