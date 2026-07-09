-- Community Notes on Everything: queue + claims + notes + anonymous votes,
-- served to a PUBLIC frontend (GitHub Pages) straight from Supabase with the
-- anon key baked into the site. The anon key is public by design, so this
-- migration also locks the anon role out of every other table in the schema —
-- until now the repo had no RLS at all and the anon key could read anything.
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

-- One row per piece of content (queue + display header).
create table everything_items (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('youtube', 'substack')),
  url          text not null unique,
  title        text,
  published_at date,                     -- when the content was published (feeds the claim's "posted" date)
  status       text not null default 'queued'
               check (status in ('queued', 'processing', 'done', 'error')),
  error        text,
  created_at   timestamptz not null default now(),   -- when enqueued
  processed_at timestamptz
);

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

-- One row per (note, anonymous voter). voter_id is a random UUID minted in the
-- voter's browser (localStorage); the PK makes re-votes an update, not a dupe.
create table everything_votes (
  note_id    uuid not null references everything_notes(id) on delete cascade,
  voter_id   text not null,
  vote       smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (note_id, voter_id)
);

-- ---------------------------------------------------------------------------
-- 3. Anon access: read items/claims/notes; vote only through the RPC below
-- ---------------------------------------------------------------------------

grant select on everything_items, everything_claims, everything_notes to anon;

alter table everything_items  enable row level security;
alter table everything_claims enable row level security;
alter table everything_notes  enable row level security;
alter table everything_votes  enable row level security;

create policy anon_read_items  on everything_items  for select to anon using (true);
create policy anon_read_claims on everything_claims for select to anon using (true);
create policy anon_read_notes  on everything_notes  for select to anon using (true);
-- everything_votes: no grants, no policies. Voter ids stay unreadable, so the
-- only vote anyone can change is the one whose random id their browser holds.

-- Insert-or-update a vote as a definer function instead of table grants: anon
-- gets exactly this one operation on votes and nothing else.
create or replace function cast_everything_vote(p_note_id uuid, p_voter_id text, p_vote smallint)
returns void
language sql security definer set search_path = public as $$
  insert into everything_votes (note_id, voter_id, vote)
  values (p_note_id, p_voter_id, p_vote)
  on conflict (note_id, voter_id) do update set vote = excluded.vote;
$$;
revoke execute on function cast_everything_vote(uuid, text, smallint) from public;
grant execute on function cast_everything_vote(uuid, text, smallint) to anon;

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
-- 5. Realtime: stream item/claim/note changes to the frontend. Anon realtime
--    delivers nothing without the select policies above — both are needed.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table everything_items, everything_claims, everything_notes;
