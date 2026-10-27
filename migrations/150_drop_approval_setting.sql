-- 150: the approval step is gone for good (GOO-563). Apply this once the note
-- writer on Nathan's ai-box runs the code of PR #635, which saves drafts as
-- 'posting' and no longer reads the setting.

update everything_claude_drafts set status = 'posting' where status = 'awaiting_approval';
alter table everything_claude_drafts drop constraint everything_claude_drafts_status_check;
alter table everything_claude_drafts add constraint everything_claude_drafts_status_check
  check (status in ('posting', 'posted', 'removed', 'not_a_note'));

drop function everything_claude_change_settings(text, boolean, text);
alter table everything_claude_settings drop column approval_required;

-- Changes who writes the notes.
create function everything_claude_change_settings(p_writer text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  update everything_claude_settings
     set writer = p_writer, updated_at = now(), updated_by = v_actor
   where id;
  insert into everything_claude_events (actor, type, data)
  values (v_actor, 'settings_changed', jsonb_build_object('writer', p_writer));
end;
$$;

-- The old name of the posting state is gone from the sections.
create or replace function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status in ('posted', 'posting') and d.verdict is null and not skipped
    when 'approved' then d.verdict = 'approved' or everything_claude_has_reviewer_vote(d.note_id, 1) or everything_claude_crowd_status(d.note_id) = 'helpful'
    when 'disapproved' then d.verdict = 'disapproved' or everything_claude_has_reviewer_vote(d.note_id, -1) or everything_claude_crowd_status(d.note_id) = 'not_helpful'
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'posting')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

revoke all on function everything_claude_change_settings(text, text) from public, anon, authenticated;
grant execute on function everything_claude_change_settings(text, text) to authenticated, service_role;
