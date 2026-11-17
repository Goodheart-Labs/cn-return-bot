-- 148: Approved and Disapproved also hold the notes the crowd rated (GOO-563).
--
-- Since migration 147 Approved holds every Claude note Jim or Nathan voted
-- Helpful or Somewhat helpful on, and Disapproved every one either of them
-- voted Not helpful on. Now Approved also holds every Claude note that is
-- rated helpful overall, and Disapproved every one rated not helpful overall,
-- even when neither of them voted. Such a note also stays in Not reviewed
-- until one of them votes.

-- A live note's rating state from its stored chance of ending up helpful
-- (migration 141): 'helpful', 'not_helpful' or 'needs_ratings'. Null when
-- the note is not on the site.
create function everything_claude_crowd_status(p_note uuid) returns text
language sql stable security definer set search_path = public as $$
  select everything_note_status(n.p_helpful) from everything_notes n where n.id = p_note
$$;

create or replace function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status in ('posted', 'posting', 'awaiting_approval') and d.verdict is null and not skipped
    when 'approved' then d.verdict = 'approved' or everything_claude_has_reviewer_vote(d.note_id, 1) or everything_claude_crowd_status(d.note_id) = 'helpful'
    when 'disapproved' then d.verdict = 'disapproved' or everything_claude_has_reviewer_vote(d.note_id, -1) or everything_claude_crowd_status(d.note_id) = 'not_helpful'
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'posting', 'awaiting_approval')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

revoke all on function everything_claude_crowd_status(uuid) from public, anon, authenticated;
