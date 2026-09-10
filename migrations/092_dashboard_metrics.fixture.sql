-- A miniature of production: the tables migration 092 reads, with the same
-- grants and policies, so both functions can be exercised for real. The rows
-- are hand-built so every number the verify file checks can be worked out by
-- eye. Ids end in a readable suffix: devices d1..d3, accounts a1..a3, items
-- 101..105, claims 201..210, notes 301..308.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/092_dashboard_metrics.fixture.sql
--   $PSQL --single-transaction -f migrations/092_dashboard_metrics.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/092_dashboard_metrics.verify.sql
--   sudo docker stop cn-migration-test
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event      text not null check (event in (
    'pageview', 'notes_shown', 'extension_installed', 'sign_in_started', 'signed_in',
    'vote_gated_login', 'write_note_teaser_shown', 'improvement_write_rejected', 'note_write_rejected')),
  platform   text not null check (platform in ('web', 'extension')),
  device_id  uuid not null,
  user_id    uuid,
  props      jsonb not null default '{}'
);
create index everything_events_created_at on everything_events (created_at);
alter table everything_events enable row level security;
grant insert on everything_events to anon, authenticated;
-- Production checks user_id against the JWT; there is no JWT here.
create policy events_insert on everything_events for insert to anon, authenticated with check (true);

create table everything_items (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,
  status        text not null default 'queued' check (status in ('queued', 'processing', 'done', 'error')),
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  checked_scope text check (checked_scope in ('page', 'paragraph'))
);
create table everything_claims (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references everything_items(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'skipped', 'no_note', 'note', 'error')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table everything_notes (
  id                     uuid primary key default gen_random_uuid(),
  claim_id               uuid not null references everything_claims(id) on delete cascade,
  author_id              uuid,
  status                 text not null default 'published' check (status in ('published', 'draft', 'hidden')),
  improved_from_note_id  uuid references everything_notes(id) on delete set null,
  helpful_count          int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count      int not null default 0,
  created_at             timestamptz not null default now()
);
create table everything_votes (
  note_id    uuid not null references everything_notes(id) on delete cascade,
  voter_id   uuid not null,
  vote       smallint not null check (vote in (1, 0, -1)),
  created_at timestamptz not null default now(),
  platform   text check (platform in ('web', 'extension')),
  primary key (note_id, voter_id)
);
grant select on everything_items, everything_claims, everything_notes to anon, authenticated;
alter table everything_items  enable row level security;
alter table everything_claims enable row level security;
alter table everything_notes  enable row level security;
alter table everything_votes  enable row level security;
create policy anon_read_items  on everything_items  for select to anon, authenticated using (true);
create policy anon_read_claims on everything_claims for select to anon, authenticated using (true);
create policy anon_read_notes  on everything_notes  for select to anon, authenticated using (status <> 'hidden');

-- The author self-vote trigger from 058, so the vote exclusion is exercised
-- against rows the real mechanism writes. It stamps the note's created_at on
-- the vote, which production gets for free because both happen in one
-- transaction; here the notes are backdated. The counter trigger from 051 is
-- left out and the tallies are set by hand.
create function everything_selfvote_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_votes (note_id, voter_id, vote, created_at)
    values (new.id, new.author_id, 1, new.created_at)
    on conflict (note_id, voter_id) do nothing;
  end if;
  return new;
end $$;
create trigger everything_notes_selfvote
  after insert on everything_notes for each row execute function everything_selfvote_note();

-- Events. The first row fixes where the event era begins: 2026-08-20.
insert into everything_events (event, platform, device_id, props, created_at) values
  ('pageview', 'web', '00000000-0000-0000-0000-0000000000d1', '{}', '2026-08-20 10:00+00'),
  -- 2026-09-01: d1 sees notes on three pages (2 + 1 + 4 notes), d2 on one page (5 notes).
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d1', '{"note_count": 2}', '2026-09-01 09:00+00'),
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d1', '{"note_count": 1}', '2026-09-01 10:00+00'),
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d1', '{"note_count": 4}', '2026-09-01 11:00+00'),
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d2', '{"note_count": 5}', '2026-09-01 12:00+00'),
  -- 2026-09-02: d3 sees notes on three pages, but only one row carries a
  -- usable count. One is from a build that sent no count and one sent a
  -- string. Both count as pages seen and as zero notes.
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d3', '{"note_count": 3}', '2026-09-02 09:00+00'),
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d3', '{}', '2026-09-02 10:00+00'),
  ('notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d3', '{"note_count": "9"}', '2026-09-02 11:00+00');
-- 2026-09-08: d2 sees one note on each of 21 pages, past the histogram cap.
insert into everything_events (event, platform, device_id, props, created_at)
select 'notes_shown', 'extension', '00000000-0000-0000-0000-0000000000d2', '{"note_count": 1}',
       '2026-09-08 08:00+00'::timestamptz + make_interval(mins => g)
from generate_series(1, 21) g;

-- Items. Only 101, 102 and 105 are finished pipeline checks. 103 errored,
-- 104 is a row a reader's note created and the pipeline never read. The
-- finish dates are fixed so the daily function's rows can be named.
insert into everything_items (id, url, status, checked_scope, processed_at) values
  ('00000000-0000-0000-0000-000000000101', 'https://a.substack.com/p/one',   'done',  'page',      '2026-09-05 14:00+00'),
  ('00000000-0000-0000-0000-000000000102', 'https://a.substack.com/p/two',   'done',  'page',      '2026-08-01 14:00+00'),
  ('00000000-0000-0000-0000-000000000103', 'https://a.substack.com/p/three', 'error', 'page',      '2026-09-05 15:00+00'),
  ('00000000-0000-0000-0000-000000000104', 'https://example.com/reader',     'done',  null,        null),
  ('00000000-0000-0000-0000-000000000105', 'https://a.substack.com/p/five',  'done',  'paragraph', '2026-09-06 01:00+02');

-- Claims. 204 and 207 were created by readers writing notes, not extracted.
insert into everything_claims (id, item_id, status, created_by) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'note',    null),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 'skipped', null),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000101', 'no_note', null),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000101', 'note',    '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000102', 'note',    null),
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000103', 'pending', null),
  ('00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000104', 'note',    '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-000000000208', '00000000-0000-0000-0000-000000000105', 'error',   null),
  ('00000000-0000-0000-0000-000000000209', '00000000-0000-0000-0000-000000000105', 'note',    null),
  ('00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-000000000101', 'note',    null);

-- Notes. The AI notes (no author) carry the tallies noteScore.ts documents:
-- 2 helpful + 1 somewhat is rated helpful, 2 helpful alone is not. 303 is a
-- hidden AI note and 308 a hidden human note; neither counts anywhere. The
-- first note fixes where the note era begins: 2026-08-25.
insert into everything_notes (id, claim_id, author_id, status, improved_from_note_id, helpful_count, somewhat_helpful_count, not_helpful_count, created_at) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', null, 'published', null, 2, 1, 0, '2026-08-25 10:00+00'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000205', null, 'published', null, 2, 1, 0, '2026-08-25 11:00+00'),
  ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-000000000210', null, 'published', null, 2, 0, 0, '2026-08-26 10:00+00'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000209', null, 'hidden',    null, 0, 0, 0, '2026-09-01 10:00+00'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-0000000000a1', 'draft', null, 1, 0, 0, '2026-09-01 12:00+00'),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-0000000000a2', 'draft', null, 1, 0, 0, '2026-09-02 12:00+00'),
  ('00000000-0000-0000-0000-000000000307', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000a1', 'draft', '00000000-0000-0000-0000-000000000301', 1, 0, 0, '2026-09-02 13:00+00'),
  ('00000000-0000-0000-0000-000000000308', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-0000000000a1', 'hidden', null, 1, 0, 0, '2026-09-08 12:00+00');

-- Votes cast by people. The trigger above has already added the four
-- author self-votes (304/a1, 305/a2, 307/a1, 308/a1), which must not count.
insert into everything_votes (note_id, voter_id, vote, created_at) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a2',  1, '2026-09-01 09:00+00'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-0000000000a2',  1, '2026-09-01 10:00+00'),
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a1',  1, '2026-09-02 09:00+00'),
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000a3',  1, '2026-09-02 10:00+00'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000000a3',  0, '2026-09-02 10:01+00'),
  ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-0000000000a3', -1, '2026-09-02 10:02+00'),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-0000000000a1',  1, '2026-09-08 09:00+00');
