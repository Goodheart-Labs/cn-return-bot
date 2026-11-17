-- Checks for migration 151, run after it against 151_disagreement_is_no_decision.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  nathan uuid := '00000000-0000-0000-0000-00000000000b';
  downvoted uuid := '00000000-0000-0000-0000-0000000000d3';
  note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d3');
  r jsonb := '{}';
begin
  r := r || jsonb_build_object('jims_downvote_alone_disapproves', (select verdict = 'disapproved' and reviewed_by = 'jim' from everything_claude_drafts where id = downvoted));
  insert into everything_votes (note_id, voter_id, vote, updated_at) values (note, nathan, 1, now() + interval '1 second');
  r := r || jsonb_build_object('disagreement_is_not_reviewed', (select verdict is null and reviewed_by is null from everything_claude_drafts where id = downvoted));
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object(
    'disagreement_in_not_reviewed', exists (select 1 from everything_claude_review_page('unreviewed') where id = downvoted),
    'disagreement_not_in_approved', not exists (select 1 from everything_claude_review_page('approved') where id = downvoted),
    'disagreement_not_in_disapproved', not exists (select 1 from everything_claude_review_page('disapproved') where id = downvoted)
  );
  reset role;
  update everything_votes set vote = 0, updated_at = now() + interval '2 seconds' where note_id = note and voter_id = nathan;
  r := r || jsonb_build_object('somewhat_ends_the_disagreement', (select verdict = 'disapproved' and reviewed_by = 'jim' from everything_claude_drafts where id = downvoted));
  update everything_votes set vote = -1, updated_at = now() + interval '3 seconds' where note_id = note and voter_id = nathan;
  r := r || jsonb_build_object('agreement_decides', (select verdict = 'disapproved' and reviewed_by = 'nathan' from everything_claude_drafts where id = downvoted));
  raise exception 'RESULT %', r;
end $$;
