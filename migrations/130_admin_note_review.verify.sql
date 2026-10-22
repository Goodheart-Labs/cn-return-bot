-- Checks for migration 130, run after it against 130_admin_note_review.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Every value in
-- the result should be true, and `let_through` should be an empty list.
do $$
declare
  jim uuid := gen_random_uuid();
  nathan uuid := gen_random_uuid();
  reader uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  project uuid;
  video uuid;
  post uuid;
  posted uuid;
  waiting uuid;
  no_note uuid;
  note1 uuid;
  note2 uuid;
  note3 uuid;
  stmt text;
  -- Every statement a caller who is not an admin might try. Each must fail.
  attempts text[];
  let_through text[] := '{}';
  page1 uuid[];
  page2 uuid[];
  page3 uuid[];
  last_row everything_claude_review_draft;
  s record;
  r jsonb := '{}';
begin
  insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
    (jim, 'JimMaar1@gmail.com', now(), false),
    (nathan, 'nathan@goodheartlabs.com', now(), false),
    (reader, 'reader@example.com', now(), false),
    (guest, null, null, true);
  insert into everything_projects (name) values ('Some Creator') returning id into project;
  insert into everything_items (project_id, url, title) values (project, 'https://www.youtube.com/watch?v=abc', 'A video') returning id into video;
  insert into everything_items (project_id, url, title) values (project, 'https://example.substack.com/p/post', 'A post') returning id into post;

  insert into everything_claude_drafts (item_id, passage, claim, kind, outcome, note, reasoning, sources, status, video_timing, context_paragraph, created_at)
  values (video, 'The passage in the video', 'A claim', 'missing_context', 'note', 'First text', 'Because',
          '[{"url": "https://a.example", "quote": "qa", "explanation": "ea"}, {"url": "https://b.example", "quote": "qb", "explanation": "eb"}]',
          'awaiting_approval', '{"start_seconds": 61, "end_seconds": 70, "context_url": "https://www.youtube.com/watch?v=abc&t=61s"}',
          'Before. The passage in the video. After.', now() - interval '1 minute')
  returning id into posted;
  insert into everything_claude_drafts (item_id, passage, claim, kind, outcome, note, reasoning, status, created_at)
  values (post, 'Waiting passage', 'A claim', 'small_mistake', 'note', 'Waiting text', 'Because', 'awaiting_approval', now() - interval '2 minutes')
  returning id into waiting;
  insert into everything_claude_drafts (item_id, passage, claim, kind, outcome, reasoning, status, created_at)
  values (post, 'Fine passage', 'A claim', 'small_mistake', 'no_note_needed', 'It is fine', 'not_a_note', now() - interval '3 minutes')
  returning id into no_note;
  -- 25 posted drafts nobody reviewed yet, for paging. Their times are one
  -- hour apart, so the order is known.
  insert into everything_claude_drafts (item_id, passage, claim, kind, outcome, note, reasoning, status, created_at)
  select post, 'Passage ' || g, 'A claim', 'small_mistake', 'note', 'Text ' || g, 'Because', 'posted', now() - g * interval '1 hour'
    from generate_series(1, 25) g;

  -- The Claude session posts the first draft with the service key.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  note1 := everything_claude_publish(posted, 'ai', null, 'claude');
  reset role;
  r := r || jsonb_build_object(
    'publish_posts_an_ai_note', (select author_id is null and note = 'First text' from everything_notes where id = note1),
    'publish_keeps_the_video_time', (select c.start_seconds = 61 and c.end_seconds = 70 and c.context_url like '%t=61s' and c.judgement = 'claude_code'
                                       from everything_notes n join everything_claims c on c.id = n.claim_id where n.id = note1),
    'publish_writes_the_sources_in_order', (select array_agg(url order by sort_order) = '{https://a.example,https://b.example}' from everything_note_sources where note_id = note1),
    'publish_marks_the_draft_posted', (select status = 'posted' and note_id = note1 and posted_as = 'ai' from everything_claude_drafts where id = posted)
  );

  attempts := array[
    'select * from everything_claude_review_summary()',
    format('select * from everything_claude_review_page(%L)', 'unreviewed'),
    format('select * from everything_claude_review_drafts(array[%L]::uuid[])', posted),
    format('select everything_claude_approve(%L)', waiting),
    format('select everything_claude_approve(%L, %L)', waiting, 'jim'),
    format('select everything_claude_reject(%L, %L)', posted, 'no'),
    format('select everything_claude_rewrite(%L, %L, %L, %L)', posted, 'New', 'r', 'ai'),
    format('select everything_claude_message(%L, %L)', posted, 'hi'),
    format('select everything_claude_message(%L, %L, %L)', posted, 'hi', 'claude'),
    'select everything_claude_change_settings(null, true)',
    format('select everything_claude_publish(%L, %L, null, %L)', waiting, 'ai', 'jim'),
    format('select everything_claude_remove_note(%L)', note1),
    format('select everything_claude_withdraw(%L, %L, %L)', posted, 'r', 'claude'),
    format('select everything_claude_actor(%L)', 'jim'),
    format('select * from everything_claude_review_rows(array[%L]::uuid[])', posted),
    'select * from everything_claude_drafts',
    'select * from everything_claude_events',
    'select * from everything_claude_settings',
    'select * from everything_claude_handbacks',
    'select * from everything_admins',
    'update everything_claude_settings set approval_required = true',
    format('insert into everything_claude_events (actor, type, draft_id) values (%L, %L, %L)', 'jim', 'message', posted)
  ];

  -- The anon key, a signed-in reader and an anonymous account get nothing.
  -- Each attempt runs in its own savepoint, so a statement that wrongly
  -- succeeded is undone and named in let_through.
  for s in select * from (values ('anon', null::uuid), ('authenticated', reader), ('authenticated', guest)) v(role, sub) loop
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

  -- An admin may not call the building blocks directly either.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  foreach stmt in array attempts[11:22] loop
    begin
      execute stmt;
      let_through := let_through || ('jim: ' || stmt);
    exception when others then
      null;
    end;
  end loop;

  -- Jim's page.
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object(
    'summary_names_the_reviewer', s.reviewer = 'jim',
    'summary_counts_each_section', s.unreviewed = 26 and s.waiting = 1 and s.approved = 0 and s.rejected = 0 and s.no_note = 1
  );
  select array_agg(id) into page1 from everything_claude_review_page('unreviewed', null, null, 10);
  select * into last_row from everything_claude_review_page('unreviewed', null, null, 10) offset 9 limit 1;
  select array_agg(id) into page2 from everything_claude_review_page('unreviewed', last_row.created_at, last_row.id, 10);
  select * into last_row from everything_claude_review_page('unreviewed', last_row.created_at, last_row.id, 10) offset 9 limit 1;
  select array_agg(id) into page3 from everything_claude_review_page('unreviewed', last_row.created_at, last_row.id, 10);
  r := r || jsonb_build_object(
    'pages_hold_10_10_and_6', cardinality(page1) = 10 and cardinality(page2) = 10 and cardinality(page3) = 6,
    'pages_do_not_overlap', (select count(distinct x) = 26 from unnest(page1 || page2 || page3) x),
    'page_starts_with_the_newest', page1[1] = posted,
    'one_large_page_holds_the_section', (select count(*) from everything_claude_review_page('unreviewed', null, null, 1000)) = 26,
    'page_carries_the_post', (select post_url = 'https://www.youtube.com/watch?v=abc' and creator = 'Some Creator' and context_paragraph like 'Before.%'
                                from everything_claude_review_page('unreviewed', null, null, 1))
  );

  -- Jim writes to Claude, Claude answers with the service key.
  perform everything_claude_message(posted, 'Is this right?', 'claude');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  perform everything_claude_message(posted, 'Yes', 'claude');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object(
    'chat_records_the_admin_as_themselves', (select messages = jsonb_build_array(
        jsonb_build_object('at', messages -> 0 -> 'at', 'actor', 'jim', 'text', 'Is this right?'),
        jsonb_build_object('at', messages -> 1 -> 'at', 'actor', 'claude', 'text', 'Yes'))
      from everything_claude_review_drafts(array[posted]))
  );

  -- Jim rewrites the posted note as himself.
  note2 := everything_claude_rewrite(posted, 'Second text', 'Jim rewrote it', 'me');
  reset role;
  r := r || jsonb_build_object(
    'rewrite_deletes_the_old_note_and_claim', not exists (select 1 from everything_notes where id = note1)
                                             and (select count(*) = 1 from everything_claims where item_id = video),
    'rewrite_posts_under_the_signed_in_account', (select author_id = jim and author_name = 'JimMaar1' and note = 'Second text' from everything_notes where id = note2),
    'rewrite_casts_the_authors_helpful_vote', exists (select 1 from everything_votes where note_id = note2 and voter_id = jim and vote = 1),
    'rewrite_keeps_the_video_time', (select c.start_seconds = 61 from everything_notes n join everything_claims c on c.id = n.claim_id where n.id = note2),
    'rewrite_records_jim', (select posted_as = 'jim' and note_id = note2 from everything_claude_drafts where id = posted),
    'rewrite_keeps_the_old_text', (select earlier_versions -> 0 ->> 'note' = 'First text' from everything_claude_review_rows(array[posted]))
  );

  -- Claude rewrites it again with the service key and keeps Jim's account.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  note3 := everything_claude_rewrite(posted, 'Third text', 'Claude fixed a typo', null, null, null, null, null, 'claude');
  begin
    perform everything_claude_rewrite(posted, 'Fourth text', 'r', 'me', null, null, null, null, 'claude');
    let_through := let_through || 'service key posted a note as me'::text;
  exception when others then
    null;
  end;
  reset role;
  r := r || jsonb_build_object(
    'claude_rewrite_keeps_the_account', (select author_id = jim and note = 'Third text' from everything_notes where id = note3)
  );

  -- Nathan approves the waiting draft, which goes up as an AI note, and
  -- cannot pose as Claude.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', nathan)::text, true);
  set local role authenticated;
  note1 := everything_claude_approve(waiting, 'claude');
  perform everything_claude_change_settings(null, true);
  reset role;
  r := r || jsonb_build_object(
    'approve_posts_a_waiting_note_as_ai', (select author_id is null and note = 'Waiting text' from everything_notes where id = note1),
    'approve_records_nathan', (select status = 'posted' and reviewed_by = 'nathan' and note_id = note1 from everything_claude_drafts where id = waiting),
    'approve_logs_nathan', exists (select 1 from everything_claude_events where type = 'approved' and actor = 'nathan' and draft_id = waiting),
    'settings_change', (select approval_required and updated_by = 'nathan' from everything_claude_settings)
  );

  -- Jim rejects the rewritten note.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_claude_reject(posted, 'Not good');
  select * into s from everything_claude_review_summary();
  reset role;
  r := r || jsonb_build_object(
    'reject_deletes_the_note', not exists (select 1 from everything_notes where id = note3) and not exists (select 1 from everything_claims where item_id = video),
    'reject_records_jim', (select status = 'rejected' and reviewed_by = 'jim' and note_id is null from everything_claude_drafts where id = posted),
    'summary_follows', s.unreviewed = 25 and s.waiting = 0 and s.approved = 1 and s.rejected = 1,
    'admins_know_their_reviewer', (select count(*) = 3 from everything_admins where reviewer is not null)
  );

  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
