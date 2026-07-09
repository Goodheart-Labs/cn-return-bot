-- Common Notes: projects → items → claims → notes, with authenticated voting
-- and AI-judged note improvements, served to a PUBLIC frontend (GitHub Pages)
-- straight from Supabase with the anon key baked into the site.
--
-- Anyone may READ notes anonymously (anon key, public by design). VOTING and
-- suggesting improvements require a logged-in user (magic link or X), so those
-- tables are keyed on auth.uid() and closed to anon. This migration also locks
-- the anon role out of every other table in the schema — before it the repo had
-- no RLS at all and the anon key could read anything.
--
-- Run as postgres (SQL editor / psql), on local and prod. Section 1 is safe to
-- re-run; sections 2+ are create-once like every other migration here.

-- ---------------------------------------------------------------------------
-- 1. Lockdown: default-deny for anon/authenticated across the public schema
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Future objects (created by postgres, which runs all migrations) inherit deny.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Belt and braces: RLS on every existing table. The bot is unaffected — the
-- service key maps to service_role, which bypasses RLS.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- A source we cover: a newsletter, a podcast, etc. The sidebar lists these.
create table everything_projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- One row per piece of content (queue + display header).
create table everything_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references everything_projects(id) on delete set null,
  source       text not null check (source in ('youtube', 'substack', 'podcast')),
  url          text not null unique,
  title        text,
  published_at date,                     -- when the content was published (feeds the claim's "posted" date)
  status       text not null default 'queued'
               check (status in ('queued', 'processing', 'done', 'error')),
  error        text,
  created_at   timestamptz not null default now(),   -- when enqueued
  processed_at timestamptz
);
create index everything_items_project_id_idx on everything_items(project_id);

-- One row per extracted claim — the full audit trail, including claims that
-- were skipped as confident-true or checked but needed no note.
create table everything_claims (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references everything_items(id) on delete cascade,
  claim         text not null,
  judgement     text not null,           -- Opus 7-point truth judgement at extraction
  context_quote text not null,           -- verbatim excerpt from the transcript/article
  context_url   text,                    -- youtube deep-link (…&t=123s) or substack canonical url
  start_seconds int,                     -- youtube only: context span, drives the embed ?start=
  end_seconds   int,
  status        text not null default 'pending'
                check (status in ('pending', 'skipped', 'no_note', 'note', 'error')),
  status_reason text,                    -- skip reason / pipeline outcome reason / error message
  created_at    timestamptz not null default now()
);
create index everything_claims_item_id_idx on everything_claims(item_id);

-- One row per written note (a claim has at most one).
create table everything_notes (
  id                uuid primary key default gen_random_uuid(),
  claim_id          uuid not null unique references everything_claims(id) on delete cascade,
  note              text not null,
  sources           jsonb not null default '[]',
  helpful_count     int not null default 0,
  not_helpful_count int not null default 0,
  created_at        timestamptz not null default now()
);

-- One row per (note, logged-in voter). voter_id is the Supabase auth user id;
-- the PK makes re-votes an update, not a dupe. RLS ties every row to auth.uid().
create table everything_votes (
  note_id    uuid not null references everything_notes(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  vote       smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (note_id, voter_id)
);

-- A user-proposed better note. The judge-suggestion edge function decides
-- earnest vs trolling and stamps status; only 'accepted' rows are shown publicly.
create table everything_note_suggestions (
  id             uuid primary key default gen_random_uuid(),
  note_id        uuid not null references everything_notes(id) on delete cascade,
  author_id      uuid not null references auth.users(id) on delete cascade,
  suggested_text text not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'accepted', 'rejected')),
  judge_reason   text,
  created_at     timestamptz not null default now()
);
create index everything_note_suggestions_note_id_idx on everything_note_suggestions(note_id);

-- ---------------------------------------------------------------------------
-- 3. Access
--    Public (anon + authenticated): read projects/items/claims/notes and any
--    ACCEPTED improvement. Logged-in only: cast votes (tied to auth.uid()).
--    Suggestions are inserted server-side by the edge function (service role).
-- ---------------------------------------------------------------------------

grant select on everything_projects, everything_items, everything_claims, everything_notes,
                everything_note_suggestions to anon, authenticated;
grant select, insert, update, delete on everything_votes to authenticated;

alter table everything_projects         enable row level security;
alter table everything_items            enable row level security;
alter table everything_claims           enable row level security;
alter table everything_notes            enable row level security;
alter table everything_votes            enable row level security;
alter table everything_note_suggestions enable row level security;

create policy anon_read_projects on everything_projects for select to anon, authenticated using (true);
create policy anon_read_items    on everything_items    for select to anon, authenticated using (true);
create policy anon_read_claims   on everything_claims   for select to anon, authenticated using (true);
create policy anon_read_notes    on everything_notes    for select to anon, authenticated using (true);

-- Everyone sees accepted improvements; authors additionally see their own pending/rejected ones.
create policy read_accepted_suggestions on everything_note_suggestions
  for select to anon, authenticated using (status = 'accepted' or author_id = auth.uid());

-- A logged-in user sees and manages only their own votes.
create policy own_votes_select on everything_votes for select to authenticated using (voter_id = auth.uid());
create policy own_votes_insert on everything_votes for insert to authenticated with check (voter_id = auth.uid());
create policy own_votes_update on everything_votes for update to authenticated using (voter_id = auth.uid()) with check (voter_id = auth.uid());
create policy own_votes_delete on everything_votes for delete to authenticated using (voter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Vote counters on the note row, maintained by trigger. Folds every vote
--    into a single everything_notes UPDATE — which is also the realtime event
--    the frontend already subscribes to, so counts go live for everyone.
-- ---------------------------------------------------------------------------

create or replace function everything_apply_vote()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_notes set
      helpful_count     = helpful_count     - (old.vote = 1)::int,
      not_helpful_count = not_helpful_count - (old.vote = -1)::int
    where id = old.note_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_notes set
      helpful_count     = helpful_count     + (new.vote = 1)::int,
      not_helpful_count = not_helpful_count + (new.vote = -1)::int
    where id = new.note_id;
  end if;
  return coalesce(new, old);
end $$;

create trigger everything_votes_counter
  after insert or update or delete on everything_votes
  for each row execute function everything_apply_vote();

-- ---------------------------------------------------------------------------
-- 5. Seed the initial projects (notes only exist for Dwarkesh so far).
-- ---------------------------------------------------------------------------

insert into everything_projects (slug, name, description, sort_order) values
  ('zvi',      'Zvi Mowshowitz''s newsletter', null, 1),
  ('arb',      'Arb''s Research Journal',      null, 2),
  ('dwarkesh', 'The Dwarkesh Podcast',         null, 3)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Realtime: stream content + accepted improvements to the frontend. Anon
--    realtime delivers nothing without the select policies above — both needed.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  everything_items, everything_claims, everything_notes, everything_note_suggestions;
