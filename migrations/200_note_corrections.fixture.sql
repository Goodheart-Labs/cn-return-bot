-- A miniature of production for migration 200: the notes, claims and posts it
-- reads, and an everything_is_admin() that reads a session setting instead of
-- the sign-in token, so the verify file can act as an admin and as a reader.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/200_note_corrections.fixture.sql
--   $PSQL --single-transaction -f migrations/200_note_corrections.sql
--   $PSQL -f migrations/200_note_corrections.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_items (id uuid primary key, source text not null, url text not null, full_text text);
insert into everything_items values
  ('00000000-0000-0000-0000-0000000000a1', 'substack', 'https://a.substack.com/p/one', 'text'),
  ('00000000-0000-0000-0000-0000000000a2', 'youtube', 'https://youtube.com/watch?v=x', 'text');

create table everything_claims (id uuid primary key, item_id uuid references everything_items (id), context_quote text, updated_quote text);
insert into everything_claims values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'q1', null),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'q2', null),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', 'q3', null),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a1', 'q5', null),
  -- Corrected by hand before this migration, as the six claims of migration 056 were.
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000a1', 'q6', 'q6 as it reads now'),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000a1', 'q7', null),
  ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000a2', 'q8', null),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a1', 'q9', null);

create table everything_notes (
  id uuid primary key, status text not null default 'active', claim_id uuid,
  improved_from_note_id uuid, p_helpful float8 not null default 0.5, helpful_count int not null default 1);
insert into everything_notes (id, status, claim_id) values
  ('00000000-0000-0000-0000-000000000001', 'active', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-000000000002', 'active', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-000000000003', 'hidden', '00000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-000000000004', 'active', null),
  ('00000000-0000-0000-0000-000000000005', 'active', '00000000-0000-0000-0000-0000000000c5'),
  ('00000000-0000-0000-0000-000000000006', 'active', '00000000-0000-0000-0000-0000000000c6'),
  ('00000000-0000-0000-0000-000000000007', 'active', '00000000-0000-0000-0000-0000000000c7'),
  ('00000000-0000-0000-0000-000000000008', 'active', '00000000-0000-0000-0000-0000000000c8'),
  ('00000000-0000-0000-0000-000000000009', 'active', '00000000-0000-0000-0000-0000000000c9');
-- Note 7 was rated not helpful, and note 9 has no Helpful vote.
update everything_notes set p_helpful = 0.1 where id = '00000000-0000-0000-0000-000000000007';
update everything_notes set helpful_count = 0 where id = '00000000-0000-0000-0000-000000000009';

grant all on everything_items, everything_claims, everything_notes to service_role;

create function everything_note_status(p_helpful float8) returns text language sql immutable as $$
  select case when p_helpful >= 0.78 then 'helpful' when p_helpful <= 0.2 then 'not_helpful' else 'needs_ratings' end;
$$;

create function everything_is_admin() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.admin', true), ''), 'false')::boolean;
$$;
grant execute on function everything_is_admin() to anon, authenticated, service_role;
