-- Common Notes: vote reasoning + the donation ledger.
--
-- A $2 donation is earned by a note-vote whose reasoning the voter wrote
-- (spam-gated client-side via the judge-note edge function). The vote is the
-- primary object: reasoning lives on the vote row, and the ledger references
-- the vote. Retracting the vote deletes the row and cascades the donation away
-- (the reward is for a *standing* vote-with-reasoning).
--
-- The ledger is private: own-rows RLS only, no anon access, not in realtime.
-- The team sums it via service role, donates manually, posts proof on X.
--
-- Run as postgres (SQL editor / psql), on local and prod.

-- Votes gain a surrogate id so other tables can reference a single vote
-- (the primary key stays the (note_id, voter_id) pair from 050).
alter table everything_votes add column id uuid not null default gen_random_uuid();
alter table everything_votes add constraint everything_votes_id_key unique (id);

-- The voter's written reasoning. Set only for PRIVATE reasoning — when posted
-- as a public comment (060), the text lives on the comment row instead.
alter table everything_votes add column reasoning text;

-- Thin ledger: one row per $2 earned, keyed to the vote that earned it.
-- unique(vote_id) makes double-minting structurally impossible.
create table everything_donations (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null unique references everything_votes(id) on delete cascade,
  charity text not null check (charity in ('give_directly', 'givewell', 'ace', 'ea_ltff')),
  amount_usd numeric not null default 2,
  created_at timestamptz not null default now()
);

alter table everything_donations enable row level security;
grant select, insert, update on everything_donations to authenticated;

create policy own_donations_select on everything_donations for select to authenticated
  using (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));
create policy own_donations_insert on everything_donations for insert to authenticated
  with check (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));
create policy own_donations_update on everything_donations for update to authenticated
  using (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));
