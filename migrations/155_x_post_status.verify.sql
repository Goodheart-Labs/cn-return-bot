-- Checks for migration 155, run after it against 155_x_post_status.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  d2_note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d2');
  d4_note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4');
  d4 uuid[] := array['00000000-0000-0000-0000-0000000000d4'::uuid];
  r jsonb := '{}';
  let_through text[] := '{}';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  begin
    perform everything_update_x_post(d4_note, 't4', 'deleted');
    let_through := let_through || 'a reader updated a post'::text;
  exception when others then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  begin
    perform everything_set_x_mark(d4_note, 'scheduled');
    let_through := let_through || 'scheduled without a draft'::text;
  exception when others then null;
  end;

  -- d4 is sent to Typefully for tomorrow, then moved to the day after.
  perform everything_set_x_mark(d4_note, 'scheduled', 't4', '2030-01-01 12:00+00');
  perform everything_update_x_post(d4_note, 't4', 'scheduled', '2030-01-02 12:00+00');
  r := r || jsonb_build_object('scheduled_in_fields',
    (select fields ->> 'on_x' = 'scheduled' and (fields ->> 'x_time')::timestamptz = '2030-01-02 12:00+00' from everything_review_drafts(d4)));
  -- A report about another draft of the same note changes nothing.
  perform everything_update_x_post(d4_note, 'old', 'deleted');
  r := r || jsonb_build_object('other_draft_ignored', exists (select 1 from everything_note_x_marks where note_id = d4_note));
  perform everything_update_x_post(d4_note, 't4', 'published', null, '2030-01-02 12:01+00', 'https://x.com/someone/status/1');
  r := r || jsonb_build_object('published_in_fields',
    (select fields ->> 'on_x' = 'posted' and (fields ->> 'x_time')::timestamptz = '2030-01-02 12:01+00' and fields ->> 'x_tweet_url' = 'https://x.com/someone/status/1'
       from everything_review_drafts(d4)));
  -- Once posted, a late "deleted" report leaves the mark alone.
  perform everything_update_x_post(d4_note, 't4', 'deleted');
  r := r || jsonb_build_object('posted_stays', exists (select 1 from everything_note_x_marks where note_id = d4_note and mark = 'posted'));

  -- d2 is on the leaderboard, whose page reads posted_at until migration 156.
  perform everything_set_x_mark(d2_note, 'scheduled', 't2', '2030-01-01 12:00+00');
  r := r || jsonb_build_object('scheduled_not_on_leaderboard', (select posted_at is null from everything_best_notes where note_id = d2_note));
  perform everything_update_x_post(d2_note, 't2', 'published', null, '2030-01-01 12:00+00', null);
  r := r || jsonb_build_object('published_on_leaderboard', (select posted_at = '2030-01-01 12:00+00' from everything_best_notes where note_id = d2_note));
  perform everything_set_x_mark(d2_note, 'scheduled', 't3', '2030-01-03 12:00+00');
  perform everything_update_x_post(d2_note, 't3', 'deleted');
  r := r || jsonb_build_object('deleted_draft_unmarks', not exists (select 1 from everything_note_x_marks where note_id = d2_note));
  reset role;
  raise exception 'results: % let through: %', r, let_through;
end;
$$;
