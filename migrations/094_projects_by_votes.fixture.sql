-- A miniature of production: the tables migration 094 reads, with the same
-- grants and policies, so the function can be exercised as the anon role. The
-- rows are hand-built so every score the verify file checks can be worked out
-- by eye. Ids end in a readable suffix: projects b1..b4, items 101..103,
-- claims 201..204, notes 301..304, voters e1..e3, authors f1.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/094_projects_by_votes.fixture.sql
--   $PSQL --single-transaction -f migrations/094_projects_by_votes.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/094_projects_by_votes.verify.sql
--   sudo docker stop cn-migration-test
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table everything_projects (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  sort_order int not null default 0
);
create table everything_items (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references everything_projects(id) on delete set null,
  url        text not null unique
);
create table everything_claims (
  id      uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items(id) on delete cascade
);
create table everything_notes (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references everything_claims(id) on delete cascade,
  author_id uuid,
  status    text not null default 'published' check (status in ('published', 'draft', 'hidden'))
);
create table everything_votes (
  note_id  uuid not null references everything_notes(id) on delete cascade,
  voter_id uuid not null,
  vote     smallint not null check (vote in (1, 0, -1)),
  primary key (note_id, voter_id)
);
grant select on everything_projects, everything_items, everything_claims, everything_notes to anon, authenticated;
alter table everything_projects enable row level security;
alter table everything_items    enable row level security;
alter table everything_claims   enable row level security;
alter table everything_notes    enable row level security;
alter table everything_votes    enable row level security;
create policy anon_read_projects on everything_projects for select to anon, authenticated using (true);
create policy anon_read_items    on everything_items    for select to anon, authenticated using (true);
create policy anon_read_claims   on everything_claims   for select to anon, authenticated using (true);
create policy anon_read_notes    on everything_notes    for select to anon, authenticated using (status <> 'hidden');

-- The author self-vote trigger from 058, so the vote exclusion is exercised
-- against rows the real mechanism writes.
create function everything_selfvote_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_votes (note_id, voter_id, vote)
    values (new.id, new.author_id, 1)
    on conflict (note_id, voter_id) do nothing;
  end if;
  return new;
end $$;
create trigger everything_notes_selfvote
  after insert on everything_notes for each row execute function everything_selfvote_note();

-- Four projects. Beta has no item and must not be listed. The names are chosen
-- so that sort_order, the old tie-break, would give a different order from the
-- name: Zed sits first by sort_order and Alpha last.
insert into everything_projects (id, slug, name, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'zed',   'Zed',   -1),
  ('00000000-0000-0000-0000-0000000000b2', 'alpha', 'alpha',  9),
  ('00000000-0000-0000-0000-0000000000b3', 'beta',  'Beta',   0),
  ('00000000-0000-0000-0000-0000000000b4', 'gamma', 'Gamma',  0);

insert into everything_items (id, project_id, url) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000b1', 'https://zed.example/1'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000b2', 'https://alpha.example/1'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000b4', 'https://gamma.example/1');

insert into everything_claims (id, item_id) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000103');

-- Zed: note 301 is written by f1, whose self-vote must not count. It then gets
-- one Helpful, one Somewhat helpful and one Not helpful vote: 1 + 0.5 + 0 = 1.5.
-- Note 302 is hidden and carries two Helpful votes that must not count.
-- Alpha: note 303 has no votes at all, so Alpha scores 0 but is still listed.
-- Gamma: note 304 has two Helpful votes: 2.
insert into everything_notes (id, claim_id, author_id, status) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 'published'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000202', null, 'hidden'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000203', null, 'published'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000204', null, 'published');

insert into everything_votes (note_id, voter_id, vote) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000e1',  1),
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000e2',  0),
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000e3', -1),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000000e1',  1),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000000e2',  1),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-0000000000e1',  1),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-0000000000e2',  1);
