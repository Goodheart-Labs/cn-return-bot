-- Every cast, change and retraction of a vote, kept after the vote row itself
-- is overwritten or deleted. Retracting a vote deletes its row (migration 059),
-- so until now a reader who voted, saw the tally and unclicked left no trace.
--
-- One log for all three vote tables. A vote removed because its note, entry or
-- voter was deleted is logged as 'cascaded', not 'retracted', so it is not
-- mistaken for a change of mind. An update that leaves the vote as it was
-- (only updated_at, reasoning or platform changed) is not logged.
--
-- Service role only: RLS on with no policies, and no client grants.

create table everything_vote_history (
  id         bigint generated always as identity primary key,
  vote_table text not null check (vote_table in (
    'everything_votes', 'everything_note_not_needed_votes', 'everything_passage_highlight_votes')),
  target_id  uuid not null,
  voter_id   uuid not null,
  action     text not null check (action in ('cast', 'changed', 'retracted', 'cascaded')),
  old_vote   smallint,
  new_vote   smallint,
  at         timestamptz not null default now()
);

create index everything_vote_history_target_idx on everything_vote_history (target_id, voter_id, at);
create index everything_vote_history_at_idx on everything_vote_history (at);

alter table everything_vote_history enable row level security;
revoke all on everything_vote_history from anon, authenticated;

-- tg_argv[0] names the target column, tg_argv[1] the target's table.
create function everything_log_vote() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  target uuid := (r ->> tg_argv[0])::uuid;
  voter uuid := (r ->> 'voter_id')::uuid;
  target_alive boolean;
  action text;
begin
  if tg_op = 'UPDATE' and old.vote is not distinct from new.vote then
    return null;
  end if;
  if tg_op = 'DELETE' then
    execute format('select exists (select 1 from %I where id = $1)', tg_argv[1]) into target_alive using target;
    action := case when target_alive and exists (select 1 from auth.users where id = voter)
      then 'retracted' else 'cascaded' end;
  else
    action := case tg_op when 'INSERT' then 'cast' else 'changed' end;
  end if;
  insert into everything_vote_history (vote_table, target_id, voter_id, action, old_vote, new_vote)
  values (
    tg_table_name, target, voter, action,
    case when tg_op <> 'INSERT' then old.vote end,
    case when tg_op <> 'DELETE' then new.vote end
  );
  return null;
end;
$$;

revoke all on function everything_log_vote() from public, anon, authenticated;

create trigger everything_votes_history
  after insert or update or delete on everything_votes
  for each row execute function everything_log_vote('note_id', 'everything_notes');

create trigger everything_note_not_needed_votes_history
  after insert or update or delete on everything_note_not_needed_votes
  for each row execute function everything_log_vote('entry_id', 'everything_note_not_needed');

create trigger everything_passage_highlight_votes_history
  after insert or update or delete on everything_passage_highlight_votes
  for each row execute function everything_log_vote('entry_id', 'everything_passage_highlights');
