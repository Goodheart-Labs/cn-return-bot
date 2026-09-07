-- A miniature of the production schema: just the tables migration 086 touches,
-- with the same grants and policies, so the migration can be exercised for real.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
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
  url text not null,
  item_id uuid references everything_items(id) on delete set null,
  feed_url text,
  visited_at timestamptz not null default now()
);
create table everything_followed_feeds (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null,
  feed_type text not null check (feed_type in ('substack','youtube','lesswrong')),
  feed_url text not null unique,
  priority smallint not null default 1,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  priority_until timestamptz,
  top_posts_refreshed_at timestamptz
);
create table everything_follow_requests (
  id uuid primary key default gen_random_uuid(),
  feed_type text not null check (feed_type in ('substack','youtube','lesswrong')),
  feed_url text not null,
  title text not null default '',
  user_id uuid,
  status text not null default 'pending',
  status_reason text,
  created_at timestamptz not null default now()
);

grant select on everything_projects, everything_items, everything_claims, everything_notes to anon, authenticated;
alter table everything_projects enable row level security;
create policy anon_read_projects on everything_projects for select to anon, authenticated using (true);

-- The real analytics function, so the migration's CREATE OR REPLACE has something to replace.
create or replace function everything_creator_visits(window_days int default null)
returns table (creator text, visits bigint, processed bigint, notes bigint, errored bigint)
language sql stable security definer set search_path = public as $$
  select 'x'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint where false
$$;

-- The 24 real rows, in their real shapes, including the three hand-picked slugs.
insert into everything_projects (slug, name) values
  ('zvi','Don''t Worry About the Vase'), ('dwarkesh','Dwarkesh Podcast'),
  ('acx','Astral Codex Ten'), ('natesilver','Silver Bulletin'), ('slowboring','Slow Boring'),
  ('hankschannel','hankschannel'), ('web','Around the web');
insert into everything_followed_feeds (project_slug, feed_type, feed_url, priority, created_at) values
  ('zvi','substack','https://thezvi.substack.com',0, now() - interval '18 days'),
  ('dwarkesh','youtube','https://www.youtube.com/@DwarkeshPatel',0, now() - interval '18 days'),
  ('acx','substack','https://astralcodexten.substack.com',0, now() - interval '18 days'),
  ('hankschannel','youtube','https://www.youtube.com/@hankschannel',1, now() - interval '18 days'),
  ('kurzgesagt','youtube','https://www.youtube.com/@kurzgesagt',1, now() - interval '1 days'),
  ('nathanpmyoung','substack','https://nathanpmyoung.substack.com',1, now() - interval '2 days');
-- One creator carrying a manual flag set deliberately, on an old row.
update everything_followed_feeds set priority_until = now() + interval '5 days' where project_slug = 'zvi';
-- A project with content, so the analytics function has something to attribute.
insert into everything_items (project_id, url) select id, 'https://thezvi.substack.com/p/x' from everything_projects where slug='zvi';
