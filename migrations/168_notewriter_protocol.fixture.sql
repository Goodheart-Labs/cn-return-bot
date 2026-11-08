-- A miniature of production for migration 168: only the tables and columns
-- the notewriter protocol reads or writes.
--
--   sudo docker run -d --rm --name cn-migration-test-168 -e POSTGRES_PASSWORD=test -p 55468:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55468 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/168_notewriter_protocol.fixture.sql
--   $PSQL --single-transaction -f migrations/168_notewriter_protocol.sql
--   $PSQL -f migrations/168_notewriter_protocol.verify.sql
--   $PSQL --single-transaction -f migrations/169_drop_writer_switch.sql

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table everything_projects (id uuid primary key default gen_random_uuid(), name text);

create table everything_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references everything_projects (id),
  source text not null default 'web',
  url text not null,
  title text,
  priority int not null default 0,
  status text not null default 'queued',
  full_text text,
  published_at date,
  created_at timestamptz not null default now(),
  checked_scope text,
  first_checked_at timestamptz,
  error text,
  progress jsonb,
  skip_reason text,
  processed_at timestamptz,
  retries int not null default 0
);

create table everything_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references everything_items (id) on delete cascade,
  claim text not null,
  judgement text not null,
  context_quote text,
  context_url text,
  start_seconds int,
  end_seconds int,
  status text,
  created_by uuid
);

create table everything_notes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references everything_claims (id) on delete cascade,
  note text not null,
  author_id uuid,
  author_name text,
  x_note_id text,
  feed_votes int,
  created_at timestamptz not null default now()
);
create function everything_notes_set_feed_fields() returns trigger language plpgsql as $$
begin
  new.feed_votes := coalesce(new.feed_votes, 0) + 1;
  return new;
end;
$$;
create trigger everything_notes_feed_fields before insert or update on everything_notes
  for each row execute function everything_notes_set_feed_fields();

create table everything_note_sources (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references everything_notes (id) on delete cascade,
  url text, quote text, explanation text, sort_order int
);

create table everything_note_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references everything_items (id),
  status text not null,
  status_reason text,
  selection text,
  steer text,
  created_at timestamptz not null default now()
);

create table everything_feed_schedule (
  id boolean primary key default true check (id),
  next_run_at timestamptz,
  next_run_reason text constraint everything_feed_schedule_next_run_reason_check check (next_run_reason in ('interval', 'midnight', 'idle', 'usage')),
  dispatched_at timestamptz,
  claude_failures_reported_through timestamptz not null default now(),
  claude_silence_warned_for timestamptz
);
insert into everything_feed_schedule (next_run_at, next_run_reason) values (now() + interval '20 minutes', 'idle');

create table everything_claude_settings (
  id boolean primary key default true check (id),
  writer text not null default 'claude',
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);
insert into everything_claude_settings default values;
create function everything_claude_change_settings(p_writer text, p_actor text default null) returns void
language sql as $$ update everything_claude_settings set writer = p_writer $$;

-- Migration 169 replaces it with a version that does not say who writes.
create function everything_review_summary(p_request jsonb)
returns table (reviewer text, writer text, matching bigint, newest timestamptz)
language sql as $$ select 'jim', writer, 0::bigint, now() from everything_claude_settings $$;

create table everything_claude_drafts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references everything_items (id),
  passage text, note text, sources jsonb, video_timing jsonb,
  status text, note_id uuid, posted_as text, updated_at timestamptz
);

create table everything_claude_events (
  id bigserial primary key,
  actor text, type text, draft_id uuid, item_id uuid, note_id uuid, data jsonb,
  at timestamptz not null default now()
);

create function everything_is_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('test.admin', true), 'false')::boolean
$$;

-- What 168's backfills find: a Claude note, a pipeline note, a person's note,
-- and a post Claude took and has not finished.
insert into everything_projects (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Astral Codex Ten');
insert into everything_items (id, url, status, full_text, project_id) values
  ('00000000-0000-0000-0000-000000000001', 'https://old.example/1', 'done', 'Old text', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000002', 'https://old.example/taken', 'queued', 'Taken text', '00000000-0000-0000-0000-0000000000a1');
insert into everything_claims (id, item_id, claim, judgement) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'c1', 'claude_code'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'c2', 'false'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', 'c3', 'user');
insert into everything_notes (id, claim_id, note, author_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Claude note', null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'Pipeline note', null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c3', 'Person note', '00000000-0000-0000-0000-00000000000a');
insert into everything_claude_drafts (item_id, passage, note, status, note_id, posted_as) values
  ('00000000-0000-0000-0000-000000000001', 'c1', 'Claude note', 'posted', '00000000-0000-0000-0000-0000000000d1', 'ai');
insert into everything_claude_events (actor, type, item_id, at) values
  ('claude', 'item_finished', '00000000-0000-0000-0000-000000000001', now() - interval '2 hours'),
  ('claude', 'item_taken', '00000000-0000-0000-0000-000000000002', now() - interval '1 hour');
