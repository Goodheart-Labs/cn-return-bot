-- Common Notes: standalone improvements + author auto-upvote.
--
-- An improvement stops being an anonymous sibling on the claim: it records which
-- note it improves (improved_from_note_id), so the UI can render every note as
-- its own card with jump-links between an improvement and its original.
--
-- Authors auto-upvote their own notes: a trigger casts the helpful vote at
-- insert time, atomically with the note (definer bypasses own_votes_insert RLS,
-- and the insert cascades into the everything_apply_vote counter from 050/051,
-- so helpful_count starts at 1).
--
-- Run as postgres (SQL editor / psql), on local and prod.

alter table everything_notes
  add column improved_from_note_id uuid references everything_notes(id) on delete set null;
create index everything_notes_improved_from_idx on everything_notes(improved_from_note_id);

create or replace function everything_selfvote_note()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_votes(note_id, voter_id, vote)
    values (new.id, new.author_id, 1)
    on conflict (note_id, voter_id) do nothing;
  end if;
  return new;
end $$;

create trigger everything_notes_selfvote
  after insert on everything_notes
  for each row execute function everything_selfvote_note();
