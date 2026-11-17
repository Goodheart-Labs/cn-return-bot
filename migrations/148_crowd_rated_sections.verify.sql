-- Checks for migration 148, run after it against 148_crowd_rated_sections.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  posting uuid := '00000000-0000-0000-0000-0000000000d5';
  posting2 uuid := '00000000-0000-0000-0000-0000000000d6';
  r jsonb := '{}';
begin
  -- Post the two drafts that wait, without any vote of Jim or Nathan, and let
  -- the crowd rate one helpful and the other not helpful.
  perform everything_claude_publish(posting, 'ai', 'claude');
  perform everything_claude_publish(posting2, 'ai', 'claude');
  update everything_notes set p_helpful = 0.9 where id = (select note_id from everything_claude_drafts where id = posting);
  update everything_notes set p_helpful = 0.1 where id = (select note_id from everything_claude_drafts where id = posting2);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object(
    'rated_helpful_is_in_approved', exists (select 1 from everything_claude_review_page('approved') where id = posting),
    'rated_helpful_stays_not_reviewed', exists (select 1 from everything_claude_review_page('unreviewed') where id = posting),
    'rated_not_helpful_is_in_disapproved', exists (select 1 from everything_claude_review_page('disapproved') where id = posting2),
    'rated_not_helpful_not_in_approved', not exists (select 1 from everything_claude_review_page('approved') where id = posting2)
  );
  reset role;
  raise exception 'RESULT %', r;
end $$;
