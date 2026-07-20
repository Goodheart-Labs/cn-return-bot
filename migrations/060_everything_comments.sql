-- Common Notes: comments — a public vote-with-reasoning, nesting to any depth.
--
-- A top-level comment (parent_comment_id null) is a note-vote's reasoning made
-- public: it carries the vote_id, and the $2 donation stays keyed to that vote
-- (059) — the comment and the reasoning are the same donation, never two.
-- Replies (parent_comment_id set) are ordinary discussion: earnest-gated and
-- votable, but with no vote behind them they mint no donation.
--
-- Comments take the same three-way helpfulness votes as notes; counters are
-- maintained by a clone of the 051 trigger, and authors auto-upvote their own
-- comment via a clone of the 058 self-vote trigger.
--
-- Run as postgres (SQL editor / psql), on local and prod.

create table everything_comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references everything_notes(id) on delete cascade,
  parent_comment_id uuid references everything_comments(id) on delete cascade, -- null = top-level on the note
  vote_id uuid references everything_votes(id) on delete set null,             -- set iff top-level: the vote whose reasoning this is
  author_id uuid references auth.users(id) on delete set null,
  author_name text,                                                            -- opt-in byline, captured at submit time (as on notes)
  body text not null,
  helpful_count int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create index everything_comments_note_id_idx on everything_comments(note_id);
create index everything_comments_parent_idx on everything_comments(parent_comment_id);

create table everything_comment_votes (
  comment_id uuid not null references everything_comments(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (1, 0, -1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_id)
);

-- Counter trigger: every vote change becomes one everything_comments UPDATE,
-- which is also the realtime event the frontend subscribes to (as 051 does
-- for notes).
create or replace function everything_apply_comment_vote()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_comments set
      helpful_count          = helpful_count          - (old.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count - (old.vote = 0)::int,
      not_helpful_count      = not_helpful_count      - (old.vote = -1)::int
    where id = old.comment_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_comments set
      helpful_count          = helpful_count          + (new.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count + (new.vote = 0)::int,
      not_helpful_count      = not_helpful_count      + (new.vote = -1)::int
    where id = new.comment_id;
  end if;
  return coalesce(new, old);
end $$;

create trigger everything_comment_votes_counter
  after insert or update or delete on everything_comment_votes
  for each row execute function everything_apply_comment_vote();

-- Author auto-upvotes their own comment (as 058 does for notes).
create or replace function everything_selfvote_comment()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_comment_votes(comment_id, voter_id, vote)
    values (new.id, new.author_id, 1)
    on conflict (comment_id, voter_id) do nothing;
  end if;
  return new;
end $$;

create trigger everything_comments_selfvote
  after insert on everything_comments
  for each row execute function everything_selfvote_comment();

-- RLS. 050's revoke-all default-deny means every new table needs the full
-- ritual: enable RLS, grant, policies, and (for comments) the realtime
-- publication. Votes are NOT published — counts fold into the comment row.
alter table everything_comments enable row level security;
alter table everything_comment_votes enable row level security;

grant select on everything_comments to anon, authenticated;
grant insert, delete on everything_comments to authenticated;
grant select, insert, update, delete on everything_comment_votes to authenticated;

create policy anon_read_comments on everything_comments for select
  to anon, authenticated using (status <> 'hidden');
create policy insert_own_comments on everything_comments for insert
  to authenticated with check (author_id = auth.uid());
create policy delete_own_comments on everything_comments for delete
  to authenticated using (author_id = auth.uid());

create policy own_comment_votes_select on everything_comment_votes for select
  to authenticated using (voter_id = auth.uid());
create policy own_comment_votes_insert on everything_comment_votes for insert
  to authenticated with check (voter_id = auth.uid());
create policy own_comment_votes_update on everything_comment_votes for update
  to authenticated using (voter_id = auth.uid());
create policy own_comment_votes_delete on everything_comment_votes for delete
  to authenticated using (voter_id = auth.uid());

alter publication supabase_realtime add table everything_comments;
