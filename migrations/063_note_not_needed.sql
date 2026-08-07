-- Common Notes: "Note not needed" — a flat, claim-level argument that a claim
-- needs no note at all. Keyed to the claim, so the same list renders under
-- every note on that exact text (the original, improvements, manual notes).
-- No nesting, no vote tie, no donations. Entries take the same three-way
-- helpfulness votes as notes: counters via a clone of the 051 trigger,
-- author self-upvote via a clone of the 058 trigger.
--
-- Replaces comments: everything_comments / everything_comment_votes (060) are
-- dropped, existing comment data discarded.
--
-- Run as postgres (SQL editor / psql), on local and prod.

create table everything_note_not_needed (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references everything_claims(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,                          -- opt-in byline, captured at submit time (as on notes)
  body text not null,
  helpful_count int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create index everything_note_not_needed_claim_idx on everything_note_not_needed(claim_id);

create table everything_note_not_needed_votes (
  entry_id uuid not null references everything_note_not_needed(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (1, 0, -1)),
  created_at timestamptz not null default now(),
  primary key (entry_id, voter_id)
);

-- Counter trigger: every vote change becomes one everything_note_not_needed
-- UPDATE, which is also the realtime event the frontend subscribes to.
create or replace function everything_apply_nnn_vote()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_note_not_needed set
      helpful_count          = helpful_count          - (old.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count - (old.vote = 0)::int,
      not_helpful_count      = not_helpful_count      - (old.vote = -1)::int
    where id = old.entry_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_note_not_needed set
      helpful_count          = helpful_count          + (new.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count + (new.vote = 0)::int,
      not_helpful_count      = not_helpful_count      + (new.vote = -1)::int
    where id = new.entry_id;
  end if;
  return coalesce(new, old);
end $$;

create trigger everything_note_not_needed_votes_counter
  after insert or update or delete on everything_note_not_needed_votes
  for each row execute function everything_apply_nnn_vote();

-- Author auto-upvotes their own entry (as 058 does for notes).
create or replace function everything_selfvote_nnn()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_note_not_needed_votes(entry_id, voter_id, vote)
    values (new.id, new.author_id, 1)
    on conflict (entry_id, voter_id) do nothing;
  end if;
  return new;
end $$;

create trigger everything_note_not_needed_selfvote
  after insert on everything_note_not_needed
  for each row execute function everything_selfvote_nnn();

-- RLS. 050's revoke-all default-deny means every new table needs the full
-- ritual: enable RLS, grant, policies, and the realtime publication.
-- Votes are NOT published — counts fold into the entry row.
alter table everything_note_not_needed enable row level security;
alter table everything_note_not_needed_votes enable row level security;

grant select on everything_note_not_needed to anon, authenticated;
grant insert, delete on everything_note_not_needed to authenticated;
grant select, insert, update, delete on everything_note_not_needed_votes to authenticated;

create policy anon_read_nnn on everything_note_not_needed for select
  to anon, authenticated using (status <> 'hidden');
create policy insert_own_nnn on everything_note_not_needed for insert
  to authenticated with check (author_id = auth.uid());
create policy delete_own_nnn on everything_note_not_needed for delete
  to authenticated using (author_id = auth.uid());

create policy own_nnn_votes_select on everything_note_not_needed_votes for select
  to authenticated using (voter_id = auth.uid());
create policy own_nnn_votes_insert on everything_note_not_needed_votes for insert
  to authenticated with check (voter_id = auth.uid());
create policy own_nnn_votes_update on everything_note_not_needed_votes for update
  to authenticated using (voter_id = auth.uid());
create policy own_nnn_votes_delete on everything_note_not_needed_votes for delete
  to authenticated using (voter_id = auth.uid());

alter publication supabase_realtime add table everything_note_not_needed;

-- Drop comments. Dropping the tables detaches their triggers and removes
-- everything_comments from the realtime publication automatically.
drop table everything_comment_votes;
drop table everything_comments;
drop function everything_apply_comment_vote();
drop function everything_selfvote_comment();
