-- Checks for migration 149, run after it against 149_more_crowd_ratings.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  target uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4');
  r jsonb := '{}';
begin
  update everything_notes set helpful_count = 0, somewhat_helpful_count = 0, not_helpful_count = 2, p_helpful = 0.3 where id = target;
  r := r || jsonb_build_object('only_downvotes', everything_claude_crowd_rating(target) = 'downvoted');
  update everything_notes set p_helpful = 0.1 where id = target;
  r := r || jsonb_build_object('rated_not_helpful', everything_claude_crowd_rating(target) = 'not_helpful');
  update everything_notes set helpful_count = 1, p_helpful = 0.3 where id = target;
  r := r || jsonb_build_object('mixed_is_other', everything_claude_crowd_rating(target) = 'other');
  update everything_notes set not_helpful_count = 0 where id = target;
  r := r || jsonb_build_object('only_upvotes', everything_claude_crowd_rating(target) = 'upvoted');
  update everything_notes set p_helpful = 0.9 where id = target;
  r := r || jsonb_build_object('rated_helpful', everything_claude_crowd_rating(target) = 'helpful');
  raise exception 'RESULT %', r;
end $$;
