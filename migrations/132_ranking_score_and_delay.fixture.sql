-- A miniature of production for testing migration 132 (GOO-549). It has only
-- what everything_creator_ranking reads, and stand-ins for the two functions
-- it calls. Run it, then the migration, then the verify file:
--   sudo docker run --rm -d --name pg132 -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   for f in 132_ranking_score_and_delay.fixture.sql 132_ranking_score_and_delay.sql 132_ranking_score_and_delay.verify.sql; do
--     PGPASSWORD=test psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 --single-transaction -f migrations/$f; done

create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table everything_admins (email text primary key);

create table everything_projects (id uuid primary key, slug text, name text, feed_url text, priority_until timestamptz);
create table everything_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references everything_projects (id),
  url text unique,
  status text,
  checked_scope text,
  priority int not null default 0,
  published_at date,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create table everything_top_posts (url text);
create table everything_claims (id uuid primary key, item_id uuid);
create table everything_notes (id uuid primary key, claim_id uuid, created_at timestamptz);
create table everything_votes (note_id uuid, voter_id uuid, platform text);
create table everything_link_visits (feed_url text, page_url text, reader_hash text, visited_at timestamptz);

create function everything_visit_page(url text) returns text language sql immutable as $$ select url $$;
create function everything_creator_visit_scores(last_posts int)
returns table (feed_url text, visitors_per_post float8, posts bigint, people bigint)
language sql stable as $$
  values ('https://thezvi.substack.com', 4.0::float8, 10::bigint, 40::bigint),
         -- Scores 1.08 with the imagined posts of the verify file: walked.
         ('https://steady.substack.com', 1.3::float8, 10::bigint, 5::bigint),
         -- Scores 0.98: not walked, although its plain average is above 1.
         ('https://lowish.substack.com', 1.15::float8, 10::bigint, 4::bigint),
         -- One post read by 8 people: not walked, it has too few posts.
         ('https://onepost.substack.com', 8.0::float8, 1::bigint, 8::bigint)
$$;

-- The function as migration 131 left it, so 132 replaces an existing one.
create function everything_creator_ranking(last_posts int, min_score float8, min_posts int)
returns table (feed_url text, project_slug text, project_name text, priority_until timestamptz,
  visitors_per_post float8, score_posts bigint, people bigint, delay_posts bigint, median_delay_hours float8,
  vote_posts bigint, vote_visitors bigint, extension_voters bigint)
language sql stable as $$ select null::text, null, null, null::timestamptz, null::float8, null::bigint, null::bigint, null::bigint, null::float8, null::bigint, null::bigint, null::bigint where false $$;

insert into everything_projects values ('00000000-0000-0000-0000-000000000001', 'thezvi', 'Zvi', 'https://thezvi.substack.com', now() + interval '3 days');
