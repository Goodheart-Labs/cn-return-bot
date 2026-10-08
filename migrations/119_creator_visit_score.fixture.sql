-- A miniature of production for migration 119: the tables its functions read,
-- the function from migration 102 it keeps using, and the two functions it
-- replaces. The rows are hand-built so every number the verify file checks can
-- be worked out by eye.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/119_creator_visit_score.fixture.sql
--   $PSQL --single-transaction -f migrations/119_creator_visit_score.sql
--   $PSQL -f migrations/119_creator_visit_score.verify.sql
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
  project_id uuid references everything_projects(id),
  url text not null unique,
  title text,
  status text not null default 'done',
  checked_scope text default 'page',
  published_at date,
  processed_at timestamptz default now()
);
create table everything_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references everything_items(id),
  status text not null default 'note',
  created_by uuid
);
create table everything_notes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references everything_claims(id),
  author_id uuid,
  status text not null default 'visible'
);
create table everything_link_visits (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  item_id uuid references everything_items(id),
  visited_at timestamptz not null default now(),
  feed_url text,
  reader_hash text
);

-- Unchanged from migration 102.
create function everything_visit_page(url text)
returns text
language sql
immutable
as $$
  select coalesce(
    'https://www.youtube.com/watch?v=' || coalesce(
      (regexp_match(url, '^https?://([\w-]+\.)?youtube\.com/watch\?(.*&)?v=([\w-]+)', 'i'))[3],
      (regexp_match(url, '^https?://([\w-]+\.)?youtube\.com/(shorts|live|embed)/([\w-]+)', 'i'))[3],
      (regexp_match(url, '^https?://(www\.)?youtu\.be/([\w-]+)', 'i'))[2]
    ),
    regexp_replace(url, '/*([?#].*)?$', '')
  );
$$;

-- The two functions migration 119 replaces, so the drops have something to drop.
create function everything_creator_attention(since timestamptz, min_pages int)
returns table (feed_url text, visits bigint, pages bigint, readers bigint)
language sql stable as $$ select 'x'::text, 0::bigint, 0::bigint, 0::bigint where false $$;
create function everything_recent_posts(max_posts int, window_days int, min_pages int)
returns table (id uuid)
language sql stable security definer set search_path = public as $$ select null::uuid where false $$;

insert into everything_projects (slug, name, feed_url) values
  ('astralcodexten', 'Astral Codex Ten', 'https://astralcodexten.substack.com'),
  ('web', 'Around the web', null);

-- Astral Codex Ten has twelve visited posts. The ten most recently visited
-- (days 1 to 10 ago) have two people each. The two oldest (days 30 and 31 ago)
-- have five people each and fall outside the last ten, so the average is 2.
insert into everything_link_visits (url, feed_url, reader_hash, visited_at)
select 'https://astralcodexten.substack.com/p/post-' || n, 'https://astralcodexten.substack.com', 'acx-' || h, now() - n * interval '1 day'
from generate_series(1, 10) n, generate_series(1, 2) h;
insert into everything_link_visits (url, feed_url, reader_hash, visited_at)
select 'https://astralcodexten.substack.com/p/old-' || n, 'https://astralcodexten.substack.com', 'acx-' || h, now() - (29 + n) * interval '1 day'
from generate_series(1, 2) n, generate_series(1, 5) h;
-- One person reloads a post under a tracking parameter. That is still one post
-- and one person.
insert into everything_link_visits (url, feed_url, reader_hash, visited_at) values
  ('https://astralcodexten.substack.com/p/post-1?utm_source=x', 'https://astralcodexten.substack.com', 'acx-1', now());

-- A monthly writer: one post, three people, all of it two months ago. No
-- window cuts it off, so the average is 3.
insert into everything_link_visits (url, feed_url, reader_hash, visited_at)
select 'https://monthly.substack.com/p/the-one', 'https://monthly.substack.com', 'monthly-' || h, now() - interval '60 days'
from generate_series(1, 3) h;

-- One person binge-watches twelve videos of a channel. Every post has one
-- person, so the average is 1 however many videos they watch.
insert into everything_link_visits (url, feed_url, reader_hash, visited_at)
select 'https://www.youtube.com/watch?v=vid' || n, 'https://www.youtube.com/@binge', 'binge-1', now() - n * interval '1 hour'
from generate_series(1, 12) n;

-- One channel recorded under two capitalisations and with a trailing slash is
-- one creator: one video, two people.
insert into everything_link_visits (url, feed_url, reader_hash) values
  ('https://www.youtube.com/watch?v=caseA', 'https://www.youtube.com/channel/UCabc', 'case-1'),
  ('https://www.youtube.com/watch?v=caseA', 'https://www.youtube.com/channel/ucabc/', 'case-2');

-- An old row without a feed address still names its Substack publication.
insert into everything_link_visits (url, feed_url, reader_hash) values
  ('https://Oldrow.substack.com/p/a', null, 'old-1');

-- Rows without a reader hash count for nothing, however many there are.
insert into everything_link_visits (url, feed_url, reader_hash)
select 'https://hashless.substack.com/p/a', 'https://hashless.substack.com', null
from generate_series(1, 30);

-- Two finished posts for the dashboard: one by Astral Codex Ten, one in "web".
insert into everything_items (project_id, url, title)
select id, 'https://astralcodexten.substack.com/p/post-1', 'ACX post' from everything_projects where slug = 'astralcodexten';
insert into everything_items (project_id, url, title)
select id, 'https://example.com/page', 'A web page' from everything_projects where slug = 'web';
