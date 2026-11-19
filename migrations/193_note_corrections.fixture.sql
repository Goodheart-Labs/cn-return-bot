-- A miniature of production for migration 193: the notes table and an
-- everything_is_admin() that reads a session setting instead of the sign-in
-- token, so the verify file can act as an admin and as a reader.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/193_note_corrections.fixture.sql
--   $PSQL --single-transaction -f migrations/193_note_corrections.sql
--   $PSQL -f migrations/193_note_corrections.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_notes (id uuid primary key, status text not null default 'active', claim_id uuid);
insert into everything_notes values
  ('00000000-0000-0000-0000-000000000001', 'active', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-000000000002', 'active', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-000000000003', 'hidden', '00000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-000000000004', 'active', null),
  ('00000000-0000-0000-0000-000000000005', 'active', '00000000-0000-0000-0000-0000000000c5');

create function everything_is_admin() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.admin', true), ''), 'false')::boolean;
$$;
grant execute on function everything_is_admin() to anon, authenticated, service_role;
