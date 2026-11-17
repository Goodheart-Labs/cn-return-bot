-- 151: when Jim and Nathan disagree, the note is not reviewed (GOO-563).
--
-- Until now the last Helpful or Not helpful vote of either decided, and since
-- migration 147 a note they disagreed on showed in both Approved and
-- Disapproved. Jim changed that on 2026-10-27: when one of them voted Helpful
-- and the other Not helpful, the note is neither approved nor disapproved. It
-- shows in Not reviewed until they agree. Somewhat helpful still decides
-- nothing (migration 150).

-- The verdict from Jim's and Nathan's Helpful and Not helpful votes: approved
-- when all of them are Helpful, disapproved when all are Not helpful, and
-- none when there are none or they disagree. reviewed_by is whoever cast the
-- last of them.
create or replace function everything_claude_settle_verdict(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_any_helpful boolean;
  v_any_not_helpful boolean;
  v_reviewer text;
  v_at timestamptz;
  v_verdict text;
begin
  select * into d from everything_claude_drafts where note_id = p_note and status = 'posted' for update;
  if not found then return; end if;
  select coalesce(bool_or(v.vote > 0), false), coalesce(bool_or(v.vote < 0), false) into v_any_helpful, v_any_not_helpful
    from everything_votes v
   where v.note_id = p_note and v.vote <> 0 and everything_reviewer_of(v.voter_id) is not null;
  v_verdict := case
    when v_any_helpful and v_any_not_helpful then null
    when v_any_helpful then 'approved'
    when v_any_not_helpful then 'disapproved'
  end;
  if v_verdict is not null then
    select everything_reviewer_of(v.voter_id), v.updated_at into v_reviewer, v_at
      from everything_votes v
     where v.note_id = p_note and v.vote <> 0 and everything_reviewer_of(v.voter_id) is not null
     order by v.updated_at desc
     limit 1;
  end if;
  if v_verdict is not distinct from d.verdict and v_reviewer is not distinct from d.reviewed_by then return; end if;
  update everything_claude_drafts
     set verdict = v_verdict, reviewed_by = v_reviewer, reviewed_at = v_at, updated_at = now()
   where id = d.id;
  if v_verdict is distinct from d.verdict then
    insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
    values (coalesce(v_reviewer, d.reviewed_by, 'jim'), coalesce(v_verdict, 'unreviewed'), d.id, d.item_id, p_note,
            jsonb_build_object('note', d.note, 'disagreement', v_any_helpful and v_any_not_helpful));
  end if;
end;
$$;

-- A note they disagree on is in neither Approved nor Disapproved: those two
-- sections now follow the verdict, besides the overall rating.
create or replace function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status in ('posted', 'posting', 'awaiting_approval') and d.verdict is null and not skipped
    when 'approved' then d.verdict = 'approved' or everything_claude_crowd_status(d.note_id) = 'helpful'
    when 'disapproved' then d.verdict = 'disapproved' or everything_claude_crowd_status(d.note_id) = 'not_helpful'
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'posting', 'awaiting_approval')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

drop function everything_claude_has_reviewer_vote(uuid, int);

-- The verdicts of every live note with a vote of theirs, by the new rule.
select everything_claude_settle_verdict(d.note_id)
  from everything_claude_drafts d
 where d.status = 'posted'
   and exists (select 1 from everything_votes v where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null);
