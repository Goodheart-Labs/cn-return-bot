-- 193: the corrections page on commonnotes.net/corrections.
--
-- One row per note after which the author changed their post. An admin adds
-- the row on the page, with a link that shows the correction (the author's
-- reply, an edit notice, the post itself), and can take it off again. Everyone
-- reads it through the page function below. Every row must carry its evidence:
-- we do not publish "the author corrected this" without a link a reader can
-- check.

create table everything_note_corrections (
  note_id      uuid primary key references everything_notes (id) on delete cascade,
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$'),
  corrected_at timestamptz not null default now()
);
create index everything_note_corrections_recent on everything_note_corrections (corrected_at desc, note_id desc);

alter table everything_note_corrections enable row level security;
grant all on everything_note_corrections to service_role;

-- Readers get the list through everything_corrections_page, which leaves out
-- hidden notes. Only admins read the table itself.
create policy note_corrections_admin_read on everything_note_corrections for select to authenticated
  using (everything_is_admin());
grant select on everything_note_corrections to authenticated;

create policy note_corrections_admin_insert on everything_note_corrections for insert to authenticated
  with check (everything_is_admin());
grant insert (note_id, evidence_url) on everything_note_corrections to authenticated;

create policy note_corrections_admin_delete on everything_note_corrections for delete to authenticated
  using (everything_is_admin());
grant delete on everything_note_corrections to authenticated;

-- One page of the corrections, the most recent first, starting after the row
-- the last page ended on. A note that was hidden is left out, and so is a note
-- without a claim (the twin of an X note), which no Common Notes card can show.
create function everything_corrections_page(
  p_after_at timestamptz default null,
  p_after_note_id uuid default null,
  p_limit int default 30
) returns table (note_id uuid, evidence_url text, corrected_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.note_id, c.evidence_url, c.corrected_at
    from everything_note_corrections c
    join everything_notes n on n.id = c.note_id and n.status <> 'hidden' and n.claim_id is not null
   where p_after_note_id is null or (c.corrected_at, c.note_id) < (p_after_at, p_after_note_id)
   order by c.corrected_at desc, c.note_id desc
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function everything_corrections_page(timestamptz, uuid, int) from public;
grant execute on function everything_corrections_page(timestamptz, uuid, int) to anon, authenticated, service_role;
