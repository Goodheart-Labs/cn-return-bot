-- A miniature of production: the tables migration 089 touches, with the same
-- grants and policies, so the migration and its counting can be exercised for
-- real. The rows below are hand-built so every number the verify file checks
-- can be worked out by eye.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  feed_url text unique
);
create table everything_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references everything_projects(id) on delete set null,
  url text not null unique,
  status text not null default 'queued'
);
create table everything_claims (id uuid primary key default gen_random_uuid(), item_id uuid references everything_items(id));
create table everything_notes (id uuid primary key default gen_random_uuid(), claim_id uuid references everything_claims(id));
create table everything_link_visits (
  id uuid primary key default gen_random_uuid(),
  url text not null check (char_length(url) <= 2048),
  item_id uuid references everything_items(id) on delete set null,
  visited_at timestamptz not null default now(),
  feed_url text check (feed_url is null or char_length(feed_url) <= 2048)
);
alter table everything_link_visits enable row level security;
grant insert on everything_link_visits to anon, authenticated;
create policy link_visits_insert on everything_link_visits
  for insert to anon, authenticated with check (true);

-- The two functions migration 089 replaces, so the drops have something to drop.
create function everything_visit_counts(since timestamptz)
returns table (feed_url text, visits bigint)
language sql stable as $$ select 'x'::text, 0::bigint where false $$;
create function everything_creator_visits(window_days int default null)
returns table (creator text, visits bigint, processed bigint, notes bigint, errored bigint)
language sql stable security definer set search_path = public as $$
  select 'x'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint where false
$$;

insert into everything_projects (slug, name, feed_url) values
  ('thezvi', 'Don''t Worry About the Vase', 'https://thezvi.substack.com'),
  ('kurzgesagt', 'Kurzgesagt', 'https://www.youtube.com/@kurzgesagt');

-- Only the rows that exist BEFORE the migration go here, because the reader
-- hash column does not exist yet. These are the two kinds of row that will
-- never carry one: an old row from before this migration, and a row whose
-- creator could not be determined on the page. The verify file adds the
-- hashed rows afterwards, the way the extension writes them.
insert into everything_link_visits (url, feed_url, visited_at) values
  ('https://thezvi.substack.com/p/three', 'https://thezvi.substack.com', now() - interval '3 days'),
  ('https://thezvi.substack.com/p/four', null, now() - interval '40 days');
