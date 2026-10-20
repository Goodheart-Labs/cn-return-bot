-- A miniature of production for migration 128: the events table, the admins
-- table and the auth users it reads. The rows are hand-built so every count the
-- verify file checks can be worked out by eye.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/128_item_note_viewers.fixture.sql
--   $PSQL --single-transaction -f migrations/128_item_note_viewers.sql
--   $PSQL -f migrations/128_item_note_viewers.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key, email text);
create table everything_admins (email text primary key check (email = lower(email)));
create table everything_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null,
  device_id uuid not null,
  user_id uuid references auth.users (id),
  props jsonb not null default '{}'
);

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'Jim@Example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'reader@example.com');
insert into everything_admins values ('jim@example.com');

-- Post p1: three readers, one of them twice, plus a development install and a
-- device that once signed in as Jim. Its count is 3.
-- Post p2: one reader, a pageview that is not a notes_shown event, and an
-- event without an item id. Its count is 1.
-- Post p3: seen only by the team, so it does not appear at all.
insert into everything_events (event, device_id, user_id, props) values
  ('notes_shown', '00000000-0000-0000-0000-000000000001', null, '{"item_id": "p1", "install_type": "normal"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000001', null, '{"item_id": "p1", "install_type": "normal"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '{"item_id": "p1"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000003', null, '{"item_id": "p1", "install_type": "normal"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000004', null, '{"item_id": "p1", "install_type": "development"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000005', null, '{"item_id": "p1", "install_type": "normal"}'),
  ('pageview',    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', '{}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000001', null, '{"item_id": "p2"}'),
  ('pageview',    '00000000-0000-0000-0000-000000000002', null, '{"item_id": "p2"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000003', null, '{}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000004', null, '{"item_id": "p3", "install_type": "development"}'),
  ('notes_shown', '00000000-0000-0000-0000-000000000005', null, '{"item_id": "p3"}');
