-- A miniature of production for migration 184. It builds on the fixture of
-- migration 168 and adds what later migrations put on those tables.
--
--   sudo docker run -d --rm --name cn-migration-test-184 -e POSTGRES_PASSWORD=test -p 55484:5432 postgres:17
--   export PGPASSWORD=test; PSQL="psql -h 127.0.0.1 -p 55484 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/168_notewriter_protocol.fixture.sql
--   $PSQL --single-transaction -f migrations/168_notewriter_protocol.sql
--   $PSQL --single-transaction -f migrations/169_drop_writer_switch.sql
--   $PSQL --single-transaction -f migrations/177_publish_as_assigned_notewriter.sql
--   $PSQL -f migrations/184_notewriter_api.fixture.sql
--   $PSQL --single-transaction -f migrations/184_notewriter_api.sql
--   $PSQL -f migrations/184_notewriter_api.verify.sql
--   $PSQL -f migrations/184_notewriter_api.v1.verify.sql
--   $PSQL --single-transaction -f migrations/185_drop_assignments.sql

alter table everything_projects add column feed_url text, add column priority_until timestamptz;
alter table everything_items add column published_time timestamptz;
alter table everything_notes
  add column helpful_count int not null default 0,
  add column somewhat_helpful_count int not null default 0,
  add column not_helpful_count int not null default 0;

create function everything_visit_page(url text) returns text language sql immutable as $$
  select regexp_replace(lower(url), '/+$', '')
$$;

create table everything_demand_queued (
  page_url text primary key,
  kind text not null,
  readers int not null,
  queued boolean not null default true,
  queued_at timestamptz not null default now()
);

-- A post a reader asked about before the migration, at the old requested tier,
-- an old post, and a page the feed run queued because readers opened it.
insert into everything_items (id, url, status, full_text, priority, published_at) values
  ('00000000-0000-0000-0000-000000000003', 'https://old.example/requested', 'queued', 'A requested post that a reader asked about before the switch.', 2, current_date),
  ('00000000-0000-0000-0000-000000000004', 'https://old.example/ancient', 'queued', 'An ancient post nobody looks at any more, from long ago.', 0, current_date - 30),
  ('00000000-0000-0000-0000-000000000005', 'https://demanded.example/p/x', 'queued', 'A page several readers opened, published a while ago.', 1, current_date - 40);
insert into everything_note_requests (item_id, status, created_at) values
  ('00000000-0000-0000-0000-000000000003', 'enqueued', now() - interval '3 hours');
insert into everything_demand_queued (page_url, kind, readers, queued_at) values ('https://demanded.example/p/x', 'text', 4, now() - interval '1 day');
