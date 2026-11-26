-- Migration 206 (GOO-876): one name for the Claude note writer's runner.
--
-- Since GOO-787 (2026-11-19 09:03 UTC) the runner on Jim's notewriter Claude
-- account recorded its Claude runs and its usage readings as claude-ai-box,
-- after Nathan's ai-box it ran on. On 2026-11-25 it moved to the devbox for
-- good, and there it reserved posts with claude-devbox's key. So one runner
-- had two names. From now on it is claude-devbox for everything.
--
-- 1. The runs and usage readings of the notewriter account, from the rollout
--    on, move from claude-ai-box to claude-devbox. The pacing and the X share
--    read the last 7 days of one notewriter's rows, so they keep their
--    history. Rows from before the rollout keep their names: claude-ai-box's
--    were Nathan's plan on the ai-box, and claude-devbox's were the devbox's
--    dispatcher on Jim's main plan.
-- 2. everything_claude_publish posts a draft whose post has no team
--    reservation as claude-devbox, no longer as claude-ai-box.
-- 3. claude-ai-box is switched off, so the ai-box's old runner can reserve
--    nothing with its key if that box comes back. Its notes stay up.

CREATE OR REPLACE FUNCTION public.everything_claude_publish(p_draft uuid, p_posted_as text, p_actor text, p_author uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d everything_claude_drafts;
  v_item_url text;
  v_claim uuid;
  v_note uuid;
  v_posted jsonb;
  v_notewriter text;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if (p_posted_as = 'ai') <> (p_author is null) then
    raise exception 'An AI note has no author, and a person''s note needs one';
  end if;
  if p_posted_as = 'ai' then
    select r.notewriter_id into v_notewriter
      from everything_reservations r join everything_notewriters w on w.id = r.notewriter_id
     where r.item_id = d.item_id and not w.outside
     order by (r.ended_at is null) desc, r.started_at desc limit 1;
    v_posted := everything_post_note(coalesce(v_notewriter, 'claude-devbox'), d.item_id, jsonb_build_object(
      'passage', d.passage, 'note', d.note, 'sources', d.sources,
      'context_url', d.video_timing ->> 'context_url',
      'start_seconds', d.video_timing -> 'start_seconds', 'end_seconds', d.video_timing -> 'end_seconds'));
    if v_posted ->> 'kind' <> 'posted' then raise exception 'Not posted: %', v_posted ->> 'reason'; end if;
    v_note := (v_posted ->> 'note')::uuid;
  else
    select url into v_item_url from everything_items where id = d.item_id;
    insert into everything_claims (item_id, claim, judgement, context_quote, context_url, start_seconds, end_seconds, status, created_by)
    values (
      d.item_id, left(d.passage, 300), 'claude_code', d.passage,
      coalesce(d.video_timing ->> 'context_url', v_item_url),
      (d.video_timing ->> 'start_seconds')::int, (d.video_timing ->> 'end_seconds')::int,
      'note', p_author
    )
    returning id into v_claim;
    -- The trigger everything_fill_author_name replaces this placeholder with
    -- the account's own name.
    insert into everything_notes (claim_id, note, author_id, author_name)
    values (v_claim, d.note, p_author, 'author')
    returning id into v_note;
    insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
    select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
      from jsonb_array_elements(d.sources) with ordinality as t(s, n);
  end if;
  update everything_claude_drafts
     set status = 'posted', note_id = v_note, posted_as = p_posted_as, updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (p_actor, 'posted', d.id, d.item_id, v_note, jsonb_build_object('posted_as', p_posted_as, 'note', d.note));
  return v_note;
end;
$function$;

update everything_claude_usage set notewriter = 'claude-devbox'
 where notewriter = 'claude-ai-box' and at >= '2026-11-19 09:03:00+00';
update everything_claude_runs set notewriter = 'claude-devbox'
 where notewriter = 'claude-ai-box' and started_at >= '2026-11-19 09:03:00+00';

update everything_notewriters set name = 'Claude on Nathan''s ai-box (until 2026-11-25)' where id = 'claude-ai-box';
update everything_notewriters set name = 'Claude note writer' where id = 'claude-devbox';
select notewriter_admin_switch('claude-ai-box', false, 'The runner moved to the devbox for good and writes as claude-devbox (GOO-876)');
