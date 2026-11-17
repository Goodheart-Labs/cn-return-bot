-- Checks for migration 144, run after it against 144_review_note_filters.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Every value in
-- the result should be true, and `let_through` should be an empty list.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  open uuid := '00000000-0000-0000-0000-0000000000d4';
  downvoted uuid := '00000000-0000-0000-0000-0000000000d3';
  open_note uuid;
  stmt text;
  let_through text[] := '{}';
  s record;
  r jsonb := '{}';
begin
  select note_id into open_note from everything_claude_drafts where id = open;
  -- Two votes on the open note, one of them Jim's, and one on the downvoted
  -- note, which is Jim's from the fixture.
  insert into everything_votes (note_id, voter_id, vote) values (open_note, reader, 1);
  update everything_notes set feed_votes = 2, helpful_count = 1, not_helpful_count = 0 where id = open_note;
  insert into everything_votes (note_id, voter_id, vote) values (open_note, jim, 1);
  update everything_notes set feed_votes = 1, helpful_count = 0, not_helpful_count = 1 where id = (select note_id from everything_claude_drafts where id = downvoted);

  foreach stmt in array array[
    'select * from everything_claude_review_summary()',
    'select * from everything_claude_review_page(''approved'')'
  ] loop
    for s in select * from (values ('anon', null::uuid), ('authenticated', reader)) v(role, sub) loop
      perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role', s.role, 'sub', s.sub))::text, true);
      execute format('set local role %I', s.role);
      begin
        execute stmt;
        let_through := let_through || (coalesce(s.sub::text, 'anon') || ': ' || stmt);
      exception when others then
        null;
      end;
      reset role;
    end loop;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object(
    'unfiltered_counts', s.approved = 2 and s.disapproved = 2 and s.waiting = 2,
    'largest_values', s.largest_views = 7 and s.largest_votes = 2 and s.largest_helpful = 1 and s.largest_not_helpful = 1
  );
  select * into s from everything_claude_review_summary(null, 0, 2);
  r := r || jsonb_build_object('min_votes_narrows', s.approved = 1 and s.disapproved = 0 and s.waiting = 0);
  select * into s from everything_claude_review_summary(null, 0, 0, 0, 1);
  r := r || jsonb_build_object('min_not_helpful_narrows', s.approved = 0 and s.disapproved = 1);
  select * into s from everything_claude_review_summary(null, 8);
  r := r || jsonb_build_object('min_views_narrows', s.approved = 0 and s.disapproved = 0 and s.waiting = 0);
  select * into s from everything_claude_review_summary(null, 7);
  r := r || jsonb_build_object('views_count_the_post', s.waiting = 2);
  -- Jim voted on the open note and the downvoted one, so "unvoted only" hides
  -- both, unless the moment it was set lies before his votes.
  -- Inside one transaction the votes' time equals now(), so the moment is
  -- taken a second later.
  select * into s from everything_claude_review_summary(null, 0, 0, 0, 0, true, now() + interval '1 second');
  r := r || jsonb_build_object('unvoted_only_hides_his_votes', s.approved = 1 and s.disapproved = 1);
  select * into s from everything_claude_review_summary(null, 0, 0, 0, 0, true, now() - interval '1 day');
  r := r || jsonb_build_object('earlier_moment_keeps_them', s.approved = 2 and s.disapproved = 2);
  r := r || jsonb_build_object(
    'page_follows_the_filters', (select array_agg(id) = array[open] from everything_claude_review_page('approved', null, 0, 2)),
    'rows_carry_the_views', (select views = 7 from everything_claude_review_drafts(array[open])),
    'ratings_still_filter', (select count(*) = 0 from everything_claude_review_page('approved', array['helpful']))
  );
  reset role;

  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
