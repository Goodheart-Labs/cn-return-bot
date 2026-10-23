-- 132: the best notes list on commonnotes.net/notes/best (GOO-526).
--
-- One row per note on the list. The postable-notes job fills it with the
-- service key, and admins reorder it or take notes off it on the website.
-- Everyone may read it, because the page is public.
--
-- position orders the list, smallest first. It is a real number, so moving a
-- note between two others writes only that note's row: its new position is
-- the midpoint of its neighbours'.

create table everything_best_notes (
  note_id  uuid primary key references everything_notes (id) on delete cascade,
  position double precision not null,
  added_at timestamptz not null default now()
);
create index everything_best_notes_position on everything_best_notes (position);

alter table everything_best_notes enable row level security;
grant all on everything_best_notes to service_role;

create policy best_notes_read on everything_best_notes for select to anon, authenticated using (true);
grant select on everything_best_notes to anon, authenticated;

create policy best_notes_admin_insert on everything_best_notes for insert to authenticated
  with check (everything_is_admin());
grant insert (note_id, position) on everything_best_notes to authenticated;

create policy best_notes_admin_update on everything_best_notes for update to authenticated
  using (everything_is_admin()) with check (everything_is_admin());
grant update (position) on everything_best_notes to authenticated;

create policy best_notes_admin_delete on everything_best_notes for delete to authenticated
  using (everything_is_admin());
grant delete on everything_best_notes to authenticated;
