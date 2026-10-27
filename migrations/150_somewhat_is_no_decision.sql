-- 150: a Somewhat helpful vote of Jim or Nathan decides nothing (GOO-563).
--
-- Since migration 143 a Somewhat helpful vote of either of them approved a
-- Claude note. Jim changed that on 2026-10-27: only Helpful approves and only
-- Not helpful disapproves. A note whose only vote of theirs is Somewhat
-- helpful counts as not reviewed and shows in Not reviewed. On that day 13
-- notes went back there.

-- The verdict now comes from the last Helpful or Not helpful vote of Jim or
-- Nathan. Otherwise as in migration 143.
create or replace function everything_claude_settle_verdict(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_vote int;
  v_reviewer text;
  v_at timestamptz;
  v_verdict text;
begin
  select * into d from everything_claude_drafts where note_id = p_note and status = 'posted' for update;
  if not found then return; end if;
  select v.vote, everything_reviewer_of(v.voter_id), v.updated_at into v_vote, v_reviewer, v_at
    from everything_votes v
   where v.note_id = p_note and v.vote <> 0 and everything_reviewer_of(v.voter_id) is not null
   order by v.updated_at desc
   limit 1;
  v_verdict := case when v_vote is null then null when v_vote > 0 then 'approved' else 'disapproved' end;
  if v_verdict is not distinct from d.verdict and v_reviewer is not distinct from d.reviewed_by then return; end if;
  update everything_claude_drafts
     set verdict = v_verdict, reviewed_by = v_reviewer, reviewed_at = v_at, updated_at = now()
   where id = d.id;
  if v_verdict is distinct from d.verdict then
    insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
    values (coalesce(v_reviewer, d.reviewed_by), coalesce(v_verdict, 'unreviewed'), d.id, d.item_id, p_note,
            jsonb_build_object('note', d.note, 'vote', v_vote));
  end if;
end;
$$;

-- Whether Jim or Nathan cast a Helpful (1) or a Not helpful (-1) vote on the
-- note. A Somewhat helpful vote counts as neither.
create or replace function everything_claude_has_reviewer_vote(p_note uuid, p_sign int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from everything_votes v
     where v.note_id = p_note
       and v.vote = p_sign
       and everything_reviewer_of(v.voter_id) is not null
  )
$$;

-- The verdicts of every live note with a vote of theirs, by the new rule.
select everything_claude_settle_verdict(d.note_id)
  from everything_claude_drafts d
 where d.status = 'posted'
   and exists (select 1 from everything_votes v where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null);
