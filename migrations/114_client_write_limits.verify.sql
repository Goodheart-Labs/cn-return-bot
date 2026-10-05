-- Checks for migration 114. Run it after the migration. The block ends by
-- raising an error that carries every result, so whatever it created is always
-- rolled back. Every value in the result should be true.
--
-- The inserts copy what everything-core sends: ensureWebItem (items.ts),
-- postClaimWithNote (postNote.ts), postNnn (noteNotNeeded.ts),
-- postPassageHighlight (passages.ts), insertVisit (visits.ts) and
-- requestNotes (noteRequests.ts).
do $$
declare
  x_user uuid := gen_random_uuid();
  email_user uuid := gen_random_uuid();
  v_project uuid;
  v_item uuid;
  v_claim uuid;
  v_note uuid;
  v_entry uuid;
  r jsonb := '{}';
  refused boolean;
  n int;
  t timestamptz;
begin
  insert into auth.users (id, email) values (x_user, 'xperson@example.com'), (email_user, 'mailperson@example.com');
  insert into auth.identities (user_id, provider, identity_data)
    values (x_user, 'twitter', '{"user_name": "realhandle", "full_name": "Real Name"}');
  insert into everything_projects (slug, name) values ('goo346-web', 'Around the web') returning id into v_project;

  -- A signed-in reader, as PostgREST sets it up.
  perform set_config('request.jwt.claims', json_build_object('sub', x_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. The extension's own item insert still works.
  insert into everything_items (project_id, source, url, title, status)
    values (v_project, 'web', 'https://example.com/goo346', 'A page', 'done') returning id into v_item;
  r := r || jsonb_build_object('item_insert_works', v_item is not null);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status, priority) values (v_project, 'web', 'https://example.com/a', 'done', 2);
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('item_priority_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status, full_text) values (v_project, 'web', 'https://example.com/b', 'done', 'text');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('item_full_text_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'web', 'https://example.com/c', 'queued');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('item_queued_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'web', 'javascript:alert(1)', 'done');
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('item_non_web_url_refused', refused);

  -- 2. A claim and a signed note, as postClaimWithNote sends them.
  insert into everything_claims (item_id, claim, judgement, context_quote, context_paragraph, context_url, status, created_by)
    values (v_item, 'quoted text', 'user', 'quoted text', 'the paragraph', 'https://example.com/goo346', 'note', x_user)
    returning id into v_claim;
  insert into everything_notes (claim_id, note, author_id, author_name, improved_from_note_id, status)
    values (v_claim, 'my note', x_user, 'Common Notes team', null, 'draft') returning id into v_note;
  r := r || jsonb_build_object('claim_and_note_insert_work', v_note is not null);

  refused := false;
  begin
    insert into everything_claims (item_id, claim, judgement, context_quote, context_url, status, created_by, image_urls)
      values (v_item, 'q', 'user', 'q', 'https://example.com/goo346', 'note', x_user, '["https://example.com/i.png"]');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('claim_image_urls_refused', refused);

  refused := false;
  begin
    insert into everything_notes (claim_id, note, author_id, status, helpful_count) values (v_claim, 'x', x_user, 'draft', 50);
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('note_vote_counts_refused', refused);

  refused := false;
  begin
    insert into everything_notes (claim_id, note, author_id, status) values (v_claim, repeat('a', 2001), x_user, 'draft');
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('note_over_2000_chars_refused', refused);

  -- 3. A not-needed entry and a key point, both signed.
  insert into everything_note_not_needed (claim_id, author_id, author_name, body)
    values (v_claim, x_user, 'someone else', 'no note needed') returning id into v_entry;
  insert into everything_passage_highlights (item_id, kind, quote, context_paragraph, statement, probability, author_id, author_name)
    values (v_item, 'key_point', 'quoted text', 'the paragraph', 'the point', null, x_user, 'someone else');

  reset role;
  r := r || jsonb_build_object(
    'note_name_is_x_handle', (select author_name from everything_notes where id = v_note) = 'realhandle',
    'nnn_name_is_x_handle', (select author_name from everything_note_not_needed where id = v_entry) = 'realhandle',
    'highlight_name_is_x_handle', (select author_name from everything_passage_highlights where item_id = v_item) = 'realhandle',
    'note_counts_match_votes', (select n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count
                                  from everything_notes n where n.id = v_note)
                               = (select count(*) from everything_votes where note_id = v_note)
  );

  -- 4. An email account signs with the start of its address, and an unsigned
  --    note stays unsigned.
  perform set_config('request.jwt.claims', json_build_object('sub', email_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into everything_notes (claim_id, note, author_id, author_name, status) values (v_claim, 'signed', email_user, 'Fake', 'draft');
  insert into everything_notes (claim_id, note, author_id, author_name, status) values (v_claim, 'unsigned', email_user, null, 'draft');
  reset role;
  r := r || jsonb_build_object(
    'email_name_is_address_start', (select author_name from everything_notes where note = 'signed') = 'mailperson',
    'unsigned_stays_unsigned', (select author_name from everything_notes where note = 'unsigned') is null
  );

  -- 5. Visits: a backdated visit is stamped with the current time, and the
  --    hourly ceiling refuses the 1001st row.
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  set local role anon;
  insert into everything_link_visits (url, item_id, feed_url, reader_hash, visited_at)
    values ('https://example.com/goo346', null, null, repeat('a', 64), '2020-01-01');
  insert into everything_link_visits (url, item_id, feed_url, reader_hash)
    select 'https://example.com/v' || i, null, null, null from generate_series(1, 999) i;
  refused := false;
  begin
    insert into everything_link_visits (url) values ('https://example.com/one-too-many');
  exception when program_limit_exceeded then refused := true; end;
  reset role;
  r := r || jsonb_build_object(
    'backdated_visit_stamped_now', (select visited_at from everything_link_visits where reader_hash = repeat('a', 64)) > now() - interval '1 minute',
    'visit_1001_refused', refused
  );

  -- A batch that would cross the ceiling is refused as a whole.
  delete from everything_link_visits;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  set local role anon;
  refused := false;
  begin
    insert into everything_link_visits (url) select 'https://example.com/b' || i from generate_series(1, 1001) i;
  exception when program_limit_exceeded then refused := true; end;
  reset role;
  r := r || jsonb_build_object('visit_batch_over_ceiling_refused', refused,
                               'visit_batch_left_nothing', (select count(*) from everything_link_visits) = 0);

  -- 6. The pipeline's service key is never limited.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  insert into everything_link_visits (url) select 'https://example.com/s' || i from generate_series(1, 1500) i;
  insert into everything_claims (item_id, claim, judgement, context_quote, status)
    values (v_item, repeat('c', 50000), 'uncertain', repeat('c', 50000), 'pending');
  r := r || jsonb_build_object('service_key_unlimited', (select count(*) from everything_link_visits) = 1500);

  -- 7. Note requests: the request the extension sends works, and the 101st
  --    request of a day is refused.
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  set local role anon;
  insert into everything_note_requests (page_url, page_title, selection, page_text, client_token, feed_url)
    select 'https://example.com/r' || i, 'A page', null, 'text', gen_random_uuid(), null from generate_series(1, 100) i;
  refused := false;
  begin
    insert into everything_note_requests (page_url, page_title) values ('https://example.com/r101', 'A page');
  exception when program_limit_exceeded then refused := true; end;
  reset role;
  r := r || jsonb_build_object('request_101_refused', refused);

  -- 8. A press grants at most seven days, even through a direct call.
  insert into everything_projects (slug, name, feed_url) values ('goo346-creator', 'Creator', 'https://goo346creator.substack.com');
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  set local role anon;
  perform everything_extend_priority('https://goo346creator.substack.com', '2999-01-01');
  reset role;
  select priority_until into t from everything_projects where slug = 'goo346-creator';
  r := r || jsonb_build_object('priority_capped_at_seven_days', t <= now() + interval '7 days');

  -- 9. Reader spend: a passage question's cost is reader spend, a feed check
  --    is not.
  insert into everything_passage_questions (item_id, author_id, passage, question) values (v_item, x_user, 'p', 'q');
  update everything_passage_questions set cost_usd = 0.4 where author_id = x_user;
  insert into everything_pipeline_runs (claim_id, bot_name, outcome, cost, kind, work_priority)
    values (null, 'everything-bot', 'note', 1.5, 'check', 'feed');
  r := r || jsonb_build_object('reader_cost_counts_only_reader_rows', everything_reader_cost_since(now() - interval '1 minute') = 0.4);

  raise exception 'RESULT %', r;
end;
$$;
