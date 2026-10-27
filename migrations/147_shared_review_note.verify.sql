-- Checks for migration 147, run after it against 147_shared_review_note.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Every value in
-- the result should be true, and `let_through` should be an empty list.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  rejected uuid := '00000000-0000-0000-0000-0000000000d1';
  downvoted uuid := '00000000-0000-0000-0000-0000000000d3';
  open uuid := '00000000-0000-0000-0000-0000000000d4';
  let_through text[] := '{}';
  s record;
  r jsonb := '{}';
begin
  r := r || jsonb_build_object(
    'rejection_reason_became_the_note', (select review_note = 'Misses the point' and review_note_by = 'jim' and status = 'removed' from everything_claude_drafts where id = rejected),
    'explanation_became_the_note', (select review_note = 'Real error' and review_note_by = 'nathan' from everything_claude_drafts where id = open)
  );

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  begin
    perform everything_claude_set_review_note(open, 'mine');
    let_through := let_through || 'a reader set the review note'::text;
  exception when others then
    null;
  end;
  reset role;

  -- Jim edits the note Nathan started, then clears it.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_claude_set_review_note(open, 'Real error, and it matters');
  r := r || jsonb_build_object(
    'jim_edits_the_shared_note', (select review_note = 'Real error, and it matters' and review_note_by = 'jim' from everything_claude_review_drafts(array[open]))
  );
  perform everything_claude_set_review_note(open, '  ');
  reset role;
  r := r || jsonb_build_object(
    'edit_is_logged', exists (select 1 from everything_claude_events where draft_id = open and type = 'review_note' and data ->> 'previous' = 'Real error'),
    'empty_text_clears_it', (select review_note is null from everything_claude_drafts where id = open)
  );

  -- Nathan also upvotes the downvoted note: it now shows in both sections.
  insert into everything_votes (note_id, voter_id, vote, updated_at)
  select note_id, '00000000-0000-0000-0000-00000000000b', 1, now() - interval '1 day' from everything_claude_drafts where id = downvoted;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object(
    'disagreement_shows_in_approved', exists (select 1 from everything_claude_review_page('approved') where id = downvoted),
    'disagreement_shows_in_disapproved', exists (select 1 from everything_claude_review_page('disapproved') where id = downvoted),
    'its_verdict_follows_the_last_vote', (select verdict = 'disapproved' from everything_claude_review_drafts(array[downvoted]))
  );
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object('counts_follow', s.approved = 3 and s.disapproved = 2);
  reset role;

  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
