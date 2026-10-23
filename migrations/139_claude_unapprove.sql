-- 139: undo an approval on the note review page (Nathan, 2026-10-23: "when approved I can't unclick it").
--
-- everything_claude_approve (migration 130) marks a posted note as reviewed. This takes that mark off again,
-- so the note goes back to the reviewer's queue. The note itself stays on the site; only the review mark goes.
-- The page also takes back the Helpful vote that approving cast for the reviewer, through the normal vote
-- retraction, so that part needs nothing here. Like every review function, it runs with its owner's rights and
-- refuses anyone who is not an admin (everything_claude_actor).

create function everything_claude_unapprove(p_draft uuid, p_actor text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.status <> 'posted' or d.reviewed_by is null then
    raise exception 'Only an approved note that is still posted can be unapproved';
  end if;
  update everything_claude_drafts
     set reviewed_by = null, reviewed_at = null, updated_at = now()
   where id = p_draft
  returning * into d;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id)
  values (v_actor, 'unapproved', d.id, d.item_id, d.note_id);
  return d.note_id;
end;
$$;

revoke all on function everything_claude_unapprove(uuid, text) from public, anon, authenticated;
grant execute on function everything_claude_unapprove(uuid, text) to authenticated, service_role;
