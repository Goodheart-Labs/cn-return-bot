-- A miniature of production for migration 097: the one table it reads, with
-- production's grants and row security, and a handful of cost rows placed at
-- known hours relative to the current hour.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/097_spend_by_hour.fixture.sql
--   $PSQL --single-transaction -f migrations/097_spend_by_hour.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/097_spend_by_hour.verify.sql
--   sudo docker stop cn-migration-test
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_pipeline_runs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'check',
  cost       numeric,
  logs       jsonb,
  created_at timestamptz not null default now()
);
create index everything_pipeline_runs_created_at_idx on everything_pipeline_runs (created_at);
alter table everything_pipeline_runs enable row level security;
grant all on all tables in schema public to service_role;

-- Rows relative to the start of the current UTC hour, so the verify file can
-- name the bucket each one lands in. "this hour" holds two rows, "3 hours
-- ago" one, "5 hours ago" one with a null cost, "20 days ago" one outside
-- every window that is asked for.
insert into everything_pipeline_runs (kind, cost, logs, created_at) values
  ('check',      1.25, '{"prompt": "secret"}', date_trunc('hour', now()) + interval '10 minutes'),
  ('extraction', 0.50, null,                    date_trunc('hour', now()) + interval '20 minutes'),
  ('rating',     2.00, null,                    date_trunc('hour', now()) - interval '3 hours' + interval '5 minutes'),
  ('check',      null, null,                    date_trunc('hour', now()) - interval '5 hours'),
  ('check',      9.00, null,                    date_trunc('hour', now()) - interval '20 days');
