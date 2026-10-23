-- 137: admins curate the best notes from Claude's recommendations (GOO-555).
-- (applied in production on 2026-10-23 as 133, then renumbered because main took the number first.)
--
-- Migration 136's list becomes Claude's recommendations: everything_best_notes
-- is renamed to everything_note_recommendations and keeps its rows and order.
-- A new, empty everything_best_notes is the team's own leaderboard.
--
-- Moving a note to the leaderboard or removing it from the recommendations
-- records the step on the recommendation's row instead of deleting it, so the
-- reasons stay readable for a later summary of the team's taste. Both lists
-- are admin-only: the public page of migration 136 is gone.

alter table everything_best_notes rename to everything_note_recommendations;
alter index everything_best_notes_pkey rename to everything_note_recommendations_pkey;
alter index everything_best_notes_position rename to everything_note_recommendations_position;
alter table everything_note_recommendations rename constraint everything_best_notes_note_id_fkey to everything_note_recommendations_note_id_fkey;
drop policy best_notes_read on everything_note_recommendations;
drop policy best_notes_admin_insert on everything_note_recommendations;
drop policy best_notes_admin_update on everything_note_recommendations;
drop policy best_notes_admin_delete on everything_note_recommendations;
revoke all on everything_note_recommendations from anon, authenticated;

alter table everything_note_recommendations
  add column comment text check (length(comment) <= 2000),
  add column moved_at timestamptz,
  add column removed_at timestamptz,
  add column removed_reason text check (length(removed_reason) <= 2000);

comment on column everything_note_recommendations.comment is
  'An admin''s note on why this recommendation sits where it does.';
comment on column everything_note_recommendations.moved_at is
  'When an admin moved the note to the leaderboard (everything_best_notes). Null while it is a recommendation.';
comment on column everything_note_recommendations.removed_at is
  'When an admin removed the note from the recommendations, with removed_reason. Null while it is a recommendation.';

create policy note_recommendations_admin_read on everything_note_recommendations for select to authenticated
  using (everything_is_admin());
create policy note_recommendations_admin_update on everything_note_recommendations for update to authenticated
  using (everything_is_admin()) with check (everything_is_admin());
grant select on everything_note_recommendations to authenticated;
grant update (position, comment, moved_at, removed_at, removed_reason) on everything_note_recommendations to authenticated;

-- The team's leaderboard, ordered by position, smallest first.
create table everything_best_notes (
  note_id  uuid primary key references everything_notes (id) on delete cascade,
  position double precision not null,
  comment  text check (length(comment) <= 2000),
  added_at timestamptz not null default now()
);
create index everything_best_notes_position on everything_best_notes (position);

alter table everything_best_notes enable row level security;
grant all on everything_best_notes to service_role;
create policy best_notes_admin_read on everything_best_notes for select to authenticated
  using (everything_is_admin());
create policy best_notes_admin_insert on everything_best_notes for insert to authenticated
  with check (everything_is_admin());
create policy best_notes_admin_update on everything_best_notes for update to authenticated
  using (everything_is_admin()) with check (everything_is_admin());
create policy best_notes_admin_delete on everything_best_notes for delete to authenticated
  using (everything_is_admin());
grant select, delete on everything_best_notes to authenticated;
grant insert (note_id, position, comment) on everything_best_notes to authenticated;
grant update (position, comment) on everything_best_notes to authenticated;

-- Moves a recommendation to the leaderboard at the given position, in one
-- step. It runs with the caller's rights, so the policies above decide.
create function everything_move_to_leaderboard(p_note_id uuid, p_position double precision) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update everything_note_recommendations set moved_at = now() where note_id = p_note_id and moved_at is null and removed_at is null;
  if not found then
    raise exception 'note % is not an open recommendation', p_note_id;
  end if;
  insert into everything_best_notes (note_id, position, comment)
    select note_id, p_position, comment from everything_note_recommendations where note_id = p_note_id;
end;
$$;

-- Takes a note off the leaderboard and makes it a recommendation again.
create function everything_return_to_recommendations(p_note_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from everything_best_notes where note_id = p_note_id;
  if not found then
    raise exception 'note % is not on the leaderboard', p_note_id;
  end if;
  update everything_note_recommendations set moved_at = null where note_id = p_note_id;
end;
$$;

revoke execute on function everything_move_to_leaderboard(uuid, double precision) from public;
revoke execute on function everything_return_to_recommendations(uuid) from public;
grant execute on function everything_move_to_leaderboard(uuid, double precision) to authenticated, service_role;
grant execute on function everything_return_to_recommendations(uuid) to authenticated, service_role;
