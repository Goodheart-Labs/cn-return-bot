-- A miniature of production: the three tables migration 096 reads, with the
-- same grants, so the snapshot function and the trigger can be exercised for
-- real. Item ids end in a readable suffix, 101..107, claims 201..203. Times
-- are pinned to the UTC day boundary, because "finished today" is what the
-- function counts.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/096_feed_pacing.fixture.sql
--   $PSQL --single-transaction -f migrations/096_feed_pacing.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/096_feed_pacing.verify.sql
--   sudo docker stop cn-migration-test
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_items (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,
  status        text not null default 'queued' check (status in ('queued', 'processing', 'done', 'error')),
  priority      smallint not null default 0,
  checked_scope text check (checked_scope in ('page', 'paragraph')),
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
alter table everything_items enable row level security;
grant select on everything_items to anon, authenticated;
create policy anon_read_items on everything_items for select to anon, authenticated using (true);

create table everything_claims (
  id      uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items(id) on delete cascade
);
create index everything_claims_item_id_idx on everything_claims (item_id);

create table everything_pipeline_runs (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid references everything_claims(id) on delete cascade,
  item_id    uuid references everything_items(id) on delete cascade,
  kind       text not null default 'check' check (kind in ('check', 'extraction', 'rating')),
  cost       numeric,
  created_at timestamptz not null default now()
);
create index everything_pipeline_runs_claim_id_idx on everything_pipeline_runs (claim_id);
create index everything_pipeline_runs_item_id_idx on everything_pipeline_runs (item_id) where item_id is not null;
create index everything_pipeline_runs_created_at_idx on everything_pipeline_runs (created_at);
alter table everything_pipeline_runs enable row level security;

-- Supabase grants the service role every table; the fixture has to do it by hand.
grant all on all tables in schema public to service_role;

-- 101: a backlog post finished today. Extraction 0.50, rating 0.25, two
--      checks 1.00 and 0.75: 2.50 in all. One check row was written yesterday
--      (the post was cut short and resumed), which must still count.
-- 102: a priority-tier post finished today, one check written yesterday, 1.50.
-- 103: a reader-requested page (priority 2) finished today, 50.00. Not a
--      feed post, so it must not enter the mean, but its spend counts today.
-- 104: a post that errored today after spending 0.40. Not in the mean.
-- 105: a paragraph check finished today, 0.30. Not a whole page.
-- 106: a backlog post finished yesterday, 6.00. Not today, so not in the mean.
-- 107: queued, never started.
create temp view day_start as select date_trunc('day', now() at time zone 'utc') at time zone 'utc' as at;
insert into everything_items (id, url, status, priority, checked_scope, processed_at) values
  ('00000000-0000-0000-0000-000000000101', 'https://a.example/101', 'done',   0, 'page',      (select at from day_start) + interval '15 minutes'),
  ('00000000-0000-0000-0000-000000000102', 'https://a.example/102', 'done',   1, 'page',      (select at from day_start) + interval '30 minutes'),
  ('00000000-0000-0000-0000-000000000103', 'https://a.example/103', 'done',   2, 'page',      (select at from day_start) + interval '5 minutes'),
  ('00000000-0000-0000-0000-000000000104', 'https://a.example/104', 'error',  0, 'page',      (select at from day_start) + interval '6 minutes'),
  ('00000000-0000-0000-0000-000000000105', 'https://a.example/105', 'done',   0, 'paragraph', (select at from day_start) + interval '7 minutes'),
  ('00000000-0000-0000-0000-000000000106', 'https://a.example/106', 'done',   0, 'page',      (select at from day_start) - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000107', 'https://a.example/107', 'queued', 0, 'page',      null);

insert into everything_claims (id, item_id) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102');

-- Cost rows. "today" and "yesterday" are pinned to the UTC day boundary so the
-- spend check is exact whatever the wall clock says.
insert into everything_pipeline_runs (item_id, claim_id, kind, cost, created_at) values
  ('00000000-0000-0000-0000-000000000101', null, 'extraction', 0.50, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 minute'),
  ('00000000-0000-0000-0000-000000000101', null, 'rating',     0.25, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '2 minutes'),
  (null, '00000000-0000-0000-0000-000000000201', 'check',      1.00, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '3 minutes'),
  (null, '00000000-0000-0000-0000-000000000202', 'check',      0.75, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 minute'),
  (null, '00000000-0000-0000-0000-000000000203', 'check',      1.50, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000103', null, 'extraction', 50.00, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '4 minutes'),
  ('00000000-0000-0000-0000-000000000104', null, 'extraction', 0.40, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '5 minutes'),
  ('00000000-0000-0000-0000-000000000105', null, 'extraction', 0.30, date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '6 minutes'),
  ('00000000-0000-0000-0000-000000000106', null, 'extraction', 6.00, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '3 hours');
