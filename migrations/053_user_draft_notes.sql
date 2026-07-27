-- Common Notes: user-written draft notes. A claim keeps its single AI note
-- (author_id null, status 'published'); signed-in users can add their own
-- notes, shown immediately as drafts and rated like any other note. 'hidden'
-- is reserved for moderation.

alter table everything_notes drop constraint everything_notes_claim_id_key;
create index everything_notes_claim_id_idx on everything_notes(claim_id);

alter table everything_notes add column author_id uuid references auth.users(id) on delete set null;
alter table everything_notes add column author_name text;
alter table everything_notes add column status text not null default 'published'
  check (status in ('published', 'draft', 'hidden'));

-- Everyone reads everything except hidden notes (replaces the read-all policy).
drop policy anon_read_notes on everything_notes;
create policy anon_read_notes on everything_notes
  for select to anon, authenticated using (status <> 'hidden');

-- Signed-in users may add their own drafts, and remove them.
grant insert, delete on everything_notes to authenticated;
create policy insert_own_draft_notes on everything_notes
  for insert to authenticated
  with check (author_id = auth.uid() and status = 'draft');
create policy delete_own_draft_notes on everything_notes
  for delete to authenticated
  using (author_id = auth.uid() and status = 'draft');
