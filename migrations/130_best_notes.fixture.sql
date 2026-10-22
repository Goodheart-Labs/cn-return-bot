-- A miniature of production for migration 130: the notes table and an
-- everything_is_admin() that reads a session setting instead of the sign-in
-- token, so the verify file can act as an admin and as a reader.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/130_best_notes.fixture.sql
--   $PSQL --single-transaction -f migrations/130_best_notes.sql
--   $PSQL -f migrations/130_best_notes.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_notes (id uuid primary key, note text not null);
insert into everything_notes values
  ('00000000-0000-0000-0000-000000000001', 'first'),
  ('00000000-0000-0000-0000-000000000002', 'second'),
  ('00000000-0000-0000-0000-000000000003', 'third');

create function everything_is_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('test.admin', true), 'false')::boolean;
$$;
grant execute on function everything_is_admin() to anon, authenticated, service_role;
