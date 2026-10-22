-- A miniature of production for migration 130: Supabase's roles and auth
-- helpers, the admin check of migration 118, the note tables with their
-- author triggers, and then migration 129 itself. Like Supabase, it grants
-- every new table and function to anon and authenticated by default, so the
-- verify file proves that 129 and 130 take those grants away again.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/130_admin_note_review.fixture.sql
--   $PSQL --single-transaction -f migrations/130_admin_note_review.sql
--   $PSQL -f migrations/130_admin_note_review.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false
);
create table auth.identities (user_id uuid references auth.users (id), provider text, identity_data jsonb);
-- PostgREST hands the caller's token to Postgres in request.jwt.claims.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table everything_admins (email text primary key check (email = lower(email)), added_at timestamptz not null default now());
alter table everything_admins enable row level security;
revoke all on everything_admins from anon, authenticated;
insert into everything_admins (email) values ('jimmaar1@gmail.com'), ('nathanpmyoung@gmail.com'), ('nathan@goodheartlabs.com');

create function everything_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from auth.users u
    join everything_admins a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  );
$$;

create table everything_projects (id uuid primary key default gen_random_uuid(), name text not null);
create table everything_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references everything_projects (id),
  url text not null,
  title text,
  status text not null default 'done'
);
create table everything_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items (id) on delete cascade,
  claim text not null,
  judgement text not null,
  context_quote text,
  context_url text,
  start_seconds int,
  end_seconds int,
  status text not null default 'pending',
  context_paragraph text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create table everything_notes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references everything_claims (id) on delete cascade,
  note text not null,
  author_id uuid references auth.users (id),
  author_name text,
  status text not null default 'published',
  helpful_count int not null default 0,
  created_at timestamptz not null default now()
);
create table everything_note_sources (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references everything_notes (id) on delete cascade,
  url text not null,
  quote text,
  explanation text,
  sort_order int not null default 0
);
create table everything_votes (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references everything_notes (id) on delete cascade,
  voter_id uuid not null references auth.users (id),
  vote int not null,
  unique (note_id, voter_id)
);

-- The author triggers of migrations 058 and 114, as production has them.
create function everything_fill_author_name() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null and new.author_name is not null then
    new.author_name := coalesce(
      (select coalesce(identity_data->>'user_name', identity_data->>'full_name') from auth.identities where user_id = new.author_id and provider = 'twitter' limit 1),
      (select nullif(split_part(email, '@', 1), '') from auth.users where id = new.author_id),
      'anonymous'
    );
  end if;
  return new;
end $$;
create trigger everything_notes_author_name before insert on everything_notes for each row execute function everything_fill_author_name();
create function everything_selfvote_note() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_votes (note_id, voter_id, vote) values (new.id, new.author_id, 1) on conflict (note_id, voter_id) do nothing;
  end if;
  return new;
end $$;
create trigger everything_notes_selfvote after insert on everything_notes for each row execute function everything_selfvote_note();

-- The public tables are readable as on production. Migration 129 follows.
alter table everything_claims enable row level security;
alter table everything_notes enable row level security;
create policy read_claims on everything_claims for select to anon, authenticated using (true);
create policy read_notes on everything_notes for select to anon, authenticated using (status <> 'hidden');

\ir 129_claude_note_writer.sql
