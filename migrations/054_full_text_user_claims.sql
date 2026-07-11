-- Write-note anchoring: store each item's full source text so the write-note
-- flow can search the transcript and anchor notes to real spans; let signed-in
-- users create their own claims (the anchor rows their draft notes hang off).

alter table everything_items add column full_text text;

alter table everything_claims add column created_by uuid references auth.users(id) on delete set null;

grant insert on everything_claims to authenticated;
create policy insert_own_claims on everything_claims
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'note');
