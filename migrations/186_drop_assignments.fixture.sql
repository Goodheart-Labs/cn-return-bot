-- What migration 186's rewritten functions read, on top of migration 184's
-- fixture (the commands are at the top of 184_notewriter_api.fixture.sql):
--   $PSQL --single-transaction -f migrations/185_feed_run_only_for_pipeline.sql
--   $PSQL -f migrations/186_drop_assignments.fixture.sql
--   $PSQL --single-transaction -f migrations/186_drop_assignments.sql
--   $PSQL -f migrations/186_drop_assignments.verify.sql

create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function auth.role() returns text language sql as $$ select 'service_role' $$;
create table everything_admins (email text primary key);
create table everything_votes (note_id uuid, voter_id uuid, platform text);
create table everything_link_visits (feed_url text, page_url text, reader_hash text, visited_at timestamptz);
create table everything_creator_visits (feed_url text primary key, visitors_per_post float8, posts bigint, people bigint);
create table everything_pipeline_runs (id bigserial primary key, item_id uuid, claim_id uuid, cost numeric, work_priority text, created_at timestamptz default now());
create table everything_top_posts (id uuid primary key default gen_random_uuid(), feed_url text, url text);
create table everything_minisites (id uuid primary key, item_id uuid);
create table everything_minisite_jobs (kind text, minisite_id uuid, requested_by uuid);
alter table everything_projects add column slug text, add column top_posts_refreshed_at timestamptz, add column top_posts_attempted_at timestamptz;
alter table everything_items add column started_at timestamptz;
create index everything_items_queue_idx on everything_items (priority, created_at);
