-- Checks for migration 143, run after it against 143_review_by_vote.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Every value in
-- the result should be true, and `let_through` should be an empty list.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  nathan uuid := '00000000-0000-0000-0000-00000000000b';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  rejected uuid := '00000000-0000-0000-0000-0000000000d1';
  approved uuid := '00000000-0000-0000-0000-0000000000d2';
  downvoted uuid := '00000000-0000-0000-0000-0000000000d3';
  open uuid := '00000000-0000-0000-0000-0000000000d4';
  waiting uuid := '00000000-0000-0000-0000-0000000000d5';
  waiting2 uuid := '00000000-0000-0000-0000-0000000000d6';
  open_note uuid;
  downvoted_note uuid;
  waiting_note uuid;
  stmt text;
  attempts text[];
  let_through text[] := '{}';
  s record;
  r jsonb := '{}';
begin
  select note_id into open_note from everything_claude_drafts where id = open;
  select note_id into downvoted_note from everything_claude_drafts where id = downvoted;

  -- What the migration made of the old reviews.
  r := r || jsonb_build_object(
    'old_rejection_is_disapproved', (select status = 'removed' and verdict = 'disapproved' and reviewed_by = 'jim' from everything_claude_drafts where id = rejected),
    'old_approval_without_vote_stays', (select verdict = 'approved' and reviewed_by = 'nathan' from everything_claude_drafts where id = approved),
    'old_downvote_is_disapproved', (select verdict = 'disapproved' and reviewed_by = 'jim' and status = 'posted' from everything_claude_drafts where id = downvoted),
    'unreviewed_stays_open', (select verdict is null and reviewed_by is null from everything_claude_drafts where id = open)
  );

  -- Votes on the open note. A reader's vote changes nothing. Nathan's
  -- Somewhat helpful approves it, Jim's later Not helpful disapproves it, and
  -- Jim's retraction hands the decision back to Nathan's vote.
  insert into everything_votes (note_id, voter_id, vote, updated_at) values (open_note, reader, -1, now() - interval '3 seconds');
  r := r || jsonb_build_object('reader_vote_changes_nothing', (select verdict is null from everything_claude_drafts where id = open));
  insert into everything_votes (note_id, voter_id, vote, updated_at) values (open_note, nathan, 0, now() - interval '2 seconds');
  r := r || jsonb_build_object(
    'somewhat_helpful_approves', (select verdict = 'approved' and reviewed_by = 'nathan' from everything_claude_drafts where id = open),
    'approval_is_logged', exists (select 1 from everything_claude_events where draft_id = open and type = 'approved' and actor = 'nathan' and data ->> 'note' = 'Open text')
  );
  insert into everything_votes (note_id, voter_id, vote, updated_at) values (open_note, jim, -1, now() - interval '1 second');
  r := r || jsonb_build_object('later_downvote_disapproves', (select verdict = 'disapproved' and reviewed_by = 'jim' from everything_claude_drafts where id = open));
  delete from everything_votes where note_id = open_note and voter_id = jim;
  r := r || jsonb_build_object('retraction_falls_back', (select verdict = 'approved' and reviewed_by = 'nathan' from everything_claude_drafts where id = open));
  update everything_votes set vote = -1, updated_at = now() where note_id = open_note and voter_id = nathan;
  r := r || jsonb_build_object('changed_vote_disapproves', (select verdict = 'disapproved' and reviewed_by = 'nathan' from everything_claude_drafts where id = open));
  update everything_votes set vote = 1, updated_at = now() where note_id = open_note and voter_id = nathan;

  -- The crowd-rating filter. The open note now has Nathan's Helpful vote and
  -- the reader's Not helpful vote.
  update everything_notes set helpful_count = 1, not_helpful_count = 1 where id = open_note;
  update everything_notes set helpful_count = 1, not_helpful_count = 0 where id = downvoted_note;
  r := r || jsonb_build_object(
    'mixed_votes_are_other', everything_claude_crowd_rating(open_note) = 'other',
    'only_upvotes_are_upvoted', everything_claude_crowd_rating(downvoted_note) = 'upvoted',
    'no_note_is_other', everything_claude_crowd_rating(null) = 'other'
  );
  update everything_notes set p_helpful = 0.9 where id = downvoted_note;
  r := r || jsonb_build_object('rated_helpful_is_helpful', everything_claude_crowd_rating(downvoted_note) = 'helpful');
  update everything_notes set p_helpful = null where id = downvoted_note;

  -- The judge's answer counts only for the note's current text.
  insert into everything_claude_judgements (draft_id, note, p_helpful, p_impactful, reasoning) values
    (approved, 'Approved text', 0.7, 0.2, 'Good'),
    (downvoted, 'An older text', 0.3, 0.1, 'Stale');

  attempts := array[
    'select * from everything_claude_review_summary()',
    format('select * from everything_claude_review_page(%L)', 'unreviewed'),
    format('select * from everything_claude_review_drafts(array[%L]::uuid[])', open),
    format('select everything_claude_vote_waiting(%L, 1)', waiting),
    format('select everything_claude_delete_note(%L)', open),
    format('select everything_claude_skip(%L, true)', open),
    format('select everything_claude_explain(%L, %L)', open, 'why'),
    format('select everything_claude_propose(%L, %L, null, %L)', open, 'Better', 'r'),
    format('select everything_claude_settle_verdict(%L)', open_note),
    format('select * from everything_claude_review_rows(array[%L]::uuid[], %L)', open, 'jim'),
    'select * from everything_claude_judgements',
    'select * from everything_claude_skips',
    format('insert into everything_claude_skips (draft_id, reviewer) values (%L, %L)', open, 'jim')
  ];
  for s in select * from (values ('anon', null::uuid), ('authenticated', reader)) v(role, sub) loop
    perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role', s.role, 'sub', s.sub))::text, true);
    execute format('set local role %I', s.role);
    foreach stmt in array attempts loop
      begin
        execute stmt;
        let_through := let_through || (coalesce(s.sub::text, 'anon') || ': ' || stmt);
      exception when others then
        null;
      end;
    end loop;
    reset role;
  end loop;

  -- An admin may not propose as Claude, settle a verdict by hand or read the
  -- tables directly.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  foreach stmt in array attempts[8:13] loop
    begin
      execute stmt;
      let_through := let_through || ('jim: ' || stmt);
    exception when others then
      null;
    end;
  end loop;

  -- Jim's page. Open is approved by Nathan's Helpful vote, downvoted is
  -- disapproved, rejected is removed and disapproved, approved stays approved.
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object(
    'summary_counts_each_section', s.reviewer = 'jim' and s.unreviewed = 0 and s.waiting = 2 and s.approved = 2 and s.disapproved = 2 and s.no_note = 0 and s.skipped = 0
  );

  -- Jim skips the first waiting note. Nathan still sees it.
  perform everything_claude_skip(waiting, true);
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object(
    'skip_moves_the_note_for_jim', s.waiting = 1 and s.skipped = 1,
    'skipped_section_lists_it', (select array_agg(id) = array[waiting] from everything_claude_review_page('skipped')),
    'row_says_skipped', (select skipped from everything_claude_review_drafts(array[waiting]))
  );
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', nathan)::text, true);
  set local role authenticated;
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object('nathan_still_sees_it', s.waiting = 2 and s.skipped = 0);
  reset role;

  -- The crowd-rating filter on the page: only the downvoted note has only
  -- upvotes.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  select * into s from everything_claude_review_summary(array['upvoted']);
  r := r || jsonb_build_object(
    'filter_narrows_the_counts', s.disapproved = 1 and s.approved = 0 and s.waiting = 0,
    'filter_narrows_the_page', (select array_agg(id) = array[downvoted] from everything_claude_review_page('disapproved', array['upvoted']))
  );

  -- The page's rows.
  r := r || jsonb_build_object(
    'row_carries_the_judge', (select judge_p_helpful = 0.7 and judge_p_impactful = 0.2 and judge_reasoning = 'Good' from everything_claude_review_drafts(array[approved])),
    'stale_judgement_is_left_out', (select judge_p_helpful is null from everything_claude_review_drafts(array[downvoted])),
    'row_carries_the_old_rejection_reason', (select explanations -> 0 ->> 'text' = 'Misses the point' and explanations -> 0 ->> 'actor' = 'jim' from everything_claude_review_drafts(array[rejected])),
    'row_carries_the_verdict', (select verdict = 'disapproved' and status = 'removed' from everything_claude_review_drafts(array[rejected]))
  );

  -- Jim explains his view of the open note. He has no vote on it, so only
  -- the log keeps it. Nathan's explanation also lands on his vote.
  perform everything_claude_explain(open, 'Too pedantic');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', nathan)::text, true);
  set local role authenticated;
  perform everything_claude_explain(open, 'Good catch');
  reset role;
  r := r || jsonb_build_object(
    'explanation_is_logged', (select count(*) = 2 from everything_claude_events where draft_id = open and type = 'explained'),
    'explanation_lands_on_the_vote', (select reasoning = 'Good catch' from everything_votes where note_id = open_note and voter_id = nathan),
    'explanation_does_not_touch_other_votes', (select reasoning is null from everything_votes where note_id = open_note and voter_id = reader)
  );

  -- Votes on the waiting notes. Jim turns the first down, Nathan posts the
  -- second and then casts his vote on it as the page does.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('downvote_returns_no_note', everything_claude_vote_waiting(waiting, -1) is null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', nathan)::text, true);
  set local role authenticated;
  waiting_note := everything_claude_vote_waiting(waiting2, 1);
  reset role;
  insert into everything_votes (note_id, voter_id, vote) values (waiting_note, nathan, 1);
  r := r || jsonb_build_object(
    'waiting_downvote_keeps_it_off', (select status = 'removed' and verdict = 'disapproved' and reviewed_by = 'jim' and note_id is null from everything_claude_drafts where id = waiting),
    'waiting_upvote_posts_it', (select status = 'posted' and note_id = waiting_note and verdict = 'approved' and reviewed_by = 'nathan' from everything_claude_drafts where id = waiting2),
    'waiting_upvote_posts_an_ai_note', (select author_id is null and note = 'Second waiting text' from everything_notes where id = waiting_note)
  );

  -- Claude proposes a better text for the open note, and Jim posts it in its
  -- place.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  perform everything_claude_propose(open, 'Better text', '[{"url": "https://c.example", "quote": "qc", "explanation": "ec"}]', 'Jim asked', 'claude');
  reset role;
  r := r || jsonb_build_object('proposal_is_stored', (select proposed_note = 'Better text' from everything_claude_drafts where id = open));
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_claude_rewrite(open, 'Better text', 'Claude''s proposal', 'ai', '[{"url": "https://c.example", "quote": "qc", "explanation": "ec"}]');
  reset role;
  r := r || jsonb_build_object(
    'replacing_clears_the_proposal', (select proposed_note is null and proposed_sources is null and note = 'Better text' from everything_claude_drafts where id = open),
    'replacing_keeps_the_verdict', (select verdict = 'approved' and reviewed_by = 'nathan' from everything_claude_drafts where id = open),
    'replacing_posts_the_new_text', (select n.note = 'Better text' from everything_notes n join everything_claude_drafts d on d.note_id = n.id where d.id = open)
  );

  -- Jim deletes the downvoted note from the site.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_claude_delete_note(downvoted);
  reset role;
  r := r || jsonb_build_object(
    'delete_takes_the_note_off', not exists (select 1 from everything_notes where id = downvoted_note),
    'delete_keeps_it_disapproved', (select status = 'removed' and verdict = 'disapproved' and note_id is null from everything_claude_drafts where id = downvoted),
    'delete_is_logged', exists (select 1 from everything_claude_events where draft_id = downvoted and type = 'deleted' and actor = 'jim')
  );

  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
