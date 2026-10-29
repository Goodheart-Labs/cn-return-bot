-- Checks for migration 153, run after it against 153_review_fields.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
--
-- The drafts, newest first: d7 needed no note (other creator), d6 and d5 are
-- saved but not on the site, d4 is open with Nathan's Somewhat helpful vote,
-- on the leaderboard and posted on X, d3 is disapproved by Jim, d2 approved and
-- on the leaderboard, d1 deleted.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  d2 uuid := '00000000-0000-0000-0000-0000000000d2';
  d4 uuid := '00000000-0000-0000-0000-0000000000d4';
  d7 uuid := '00000000-0000-0000-0000-0000000000d7';
  r jsonb := '{}';
  let_through text[] := '{}';
  not_posted_notes jsonb := '{"filters": [{"column": "on_x", "in": ["not_posted"]}, {"column": "outcome", "in": ["note"]}], "sorts": []}';
  page uuid[];
  rest uuid[];
  last_key float8[];
  last_id uuid;
  f4 jsonb;
  f7 jsonb;
  s record;
  old_note uuid;
  d2_note uuid;
  new_note uuid;
begin
  select note_id into d2_note from everything_claude_drafts where id = d2;
  select note_id into old_note from everything_claude_drafts where id = d4;
  r := r || jsonb_build_object(
    'posted_mark_moved', (select count(*) = 1 from everything_note_x_marks m join everything_claude_drafts d on d.note_id = m.note_id where d.id = d4 and m.mark = 'posted')
  );

  -- A reader may neither read nor mark.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  begin
    perform * from everything_review_page(not_posted_notes);
    let_through := let_through || 'a reader read a page'::text;
  exception when others then null;
  end;
  begin
    perform everything_set_x_mark(d2_note, 'posted');
    let_through := let_through || 'a reader set a mark'::text;
  exception when others then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;

  select fields into f4 from everything_review_drafts(array[d4]);
  select fields into f7 from everything_review_drafts(array[d7]);
  r := r || jsonb_build_object(
    'd4_fields', f4 @> '{"on_x": "posted", "leaderboard": true, "nathan_vote": "somewhat", "jim_vote": "none", "approval": "not_reviewed", "on_site": "on_site", "creator": "some-creator", "creator_views": 7, "creator_posts": 1, "views": 7}',
    'd7_fields', f7 @> '{"outcome": "no_note_needed", "on_x": "not_posted", "creator": "other-creator", "creator_name": "Other Creator", "creator_views": 0, "creator_posts": 0, "views": 0}'
                 and f7 -> 'approval' = 'null' and f7 -> 'on_site' = 'null',
    'd2_approved', (select fields ->> 'approval' = 'approved' from everything_review_drafts(array[d2]))
  );

  -- Newest first by default, without the posted d4 and the note-less d7, two
  -- at a time.
  select array_agg(id order by t.ordinality) into page from everything_review_page(not_posted_notes, null, null, 2) with ordinality t;
  select sort_key, id into last_key, last_id from everything_review_page(not_posted_notes, null, null, 2) with ordinality t order by t.ordinality desc limit 1;
  select array_agg(id order by t.ordinality) into rest from everything_review_page(not_posted_notes, last_key, last_id, 10) with ordinality t;
  r := r || jsonb_build_object(
    'first_page', page = array['00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d5']::uuid[],
    'next_page', rest = array['00000000-0000-0000-0000-0000000000d3', d2, '00000000-0000-0000-0000-0000000000d1']::uuid[]
  );

  -- Approval best first puts approved d2 before the rest. A bucketed level by
  -- views puts the seen post's drafts before d7's.
  select array_agg(id order by t.ordinality) into page
    from everything_review_page('{"filters": [{"column": "on_site", "in": ["on_site", "deleted"]}], "sorts": [{"column": "approval", "descending": true, "order": ["disapproved", "not_reviewed", "approved"]}]}') with ordinality t;
  r := r || jsonb_build_object('approval_order', page = array[d2, d4, '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1']::uuid[]);
  select array_agg(id order by t.ordinality) into page
    from everything_review_page('{"filters": [], "sorts": [{"column": "views", "descending": false, "buckets": [1, 2, 3]}, {"column": "written", "descending": false}]}') with ordinality t;
  r := r || jsonb_build_object('views_bucket_then_oldest', page[1] = d7 and page[2] = '00000000-0000-0000-0000-0000000000d1');
  select array_agg(id order by t.ordinality) into page
    from everything_review_page('{"filters": [{"column": "published", "min": 0}, {"column": "p_helpful", "min": 0.5}], "sorts": []}') with ordinality t;
  r := r || jsonb_build_object('missing_values_fail_a_filter', page is null);

  -- Two passes: every draft is in the same written bucket, so approval
  -- decides first, and within each approval group the exact time does,
  -- oldest first as asked. Without the second pass the newest would come
  -- first, from the final tie-break.
  select array_agg(id order by t.ordinality) into page
    from everything_review_page('{"filters": [], "sorts": [{"column": "written", "descending": false, "buckets": [0]}, {"column": "approval", "descending": true, "order": ["disapproved", "not_reviewed", "approved"]}]}') with ordinality t;
  r := r || jsonb_build_object('second_pass', page = array[d2, d4, '00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d3', d7]::uuid[]);

  select * into s from everything_review_summary(not_posted_notes);
  r := r || jsonb_build_object('summary', s.reviewer = 'jim' and s.matching = 5 and s.newest is not null);
  r := r || jsonb_build_object('facets', (
    select jsonb_object_agg(field || ':' || value, drafts) from everything_review_facets(not_posted_notes, '[{"column": "on_x"}, {"column": "creator", "label_column": "creator_name"}]')
  ) = '{"on_x:posted": 1, "on_x:not_posted": 5, "creator:some-creator": 5}');

  begin
    perform * from everything_review_page('{"filters": [{"column": "id) or true or (true", "in": ["x"]}], "sorts": []}');
    let_through := let_through || 'an unknown column'::text;
  exception when others then null;
  end;
  begin
    perform * from everything_review_page('{"filters": [{"column": "views", "min": "1; drop table everything_claude_drafts"}], "sorts": []}');
    let_through := let_through || 'a value that is not a number'::text;
  exception when others then null;
  end;
  begin
    perform * from everything_review_page('{"filters": [], "sorts": [{"column": "creator", "descending": true}]}');
    let_through := let_through || 'a text sort without an order'::text;
  exception when others then null;
  end;

  -- Marks, and a rewrite that keeps the X mark.
  perform everything_set_x_mark(d2_note, 'posted');
  reset role;
  r := r || jsonb_build_object('posted_mirrored_to_leaderboard', (select posted_at is not null from everything_best_notes where note_id = d2_note));
  set local role authenticated;
  perform everything_set_x_mark(d2_note, 'wont_post');
  perform everything_claude_set_few_shot(d2, true);
  new_note := everything_claude_rewrite(d4, 'A better text', 'test');
  reset role;
  r := r || jsonb_build_object(
    'wont_post', (select mark = 'wont_post' and marked_by = 'jim' from everything_note_x_marks where note_id = d2_note),
    'wont_post_clears_leaderboard_posted', (select posted_at is null from everything_best_notes where note_id = d2_note),
    'old_functions_stay', to_regprocedure('everything_claude_review_drafts(uuid[])') is not null,
    'few_shot', exists (select 1 from everything_claude_few_shot_examples where draft_id = d2 and added_by = 'jim'),
    'rewrite_keeps_mark', new_note <> old_note and exists (select 1 from everything_note_x_marks where note_id = new_note and mark = 'posted')
  );


  raise exception 'results: % let through: %', r, let_through;
end;
$$;
