-- Checks for migration 150, run after it against 150_somewhat_is_no_decision.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  open uuid := '00000000-0000-0000-0000-0000000000d4';
  open_note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4');
  approved uuid := '00000000-0000-0000-0000-0000000000d2';
  r jsonb := '{}';
begin
  r := r || jsonb_build_object(
    'somewhat_alone_is_not_reviewed', (select verdict is null and reviewed_by is null from everything_claude_drafts where id = open),
    'old_button_approval_stays', (select verdict = 'approved' from everything_claude_drafts where id = approved)
  );
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object(
    'somewhat_alone_in_not_reviewed', exists (select 1 from everything_claude_review_page('unreviewed') where id = open),
    'somewhat_alone_not_in_approved', not exists (select 1 from everything_claude_review_page('approved') where id = open)
  );
  reset role;
  insert into everything_votes (note_id, voter_id, vote) values (open_note, jim, 1);
  r := r || jsonb_build_object('helpful_still_approves', (select verdict = 'approved' and reviewed_by = 'jim' from everything_claude_drafts where id = open));
  update everything_votes set vote = 0, updated_at = now() + interval '1 second' where note_id = open_note and voter_id = jim;
  r := r || jsonb_build_object('changing_to_somewhat_undecides', (select verdict is null from everything_claude_drafts where id = open));
  raise exception 'RESULT %', r;
end $$;
