-- Checks for migration 182, run after it (the commands are at the top of
-- 182_notewriter_api.fixture.sql). The block ends by raising an error that
-- carries every result, so nothing it wrote stays. Each result should be
-- true, and a null counts as a failure.
do $$
declare
  r jsonb := '{}';
  x jsonb;
  y jsonb;
  key text;
  new_key text;
  post uuid := '00000000-0000-0000-0000-0000000001a1';
  feed_post uuid := '00000000-0000-0000-0000-0000000001a2';
  other_assignment uuid;
  good jsonb := '{"passage": "the study had 4,000 participants", "note": "It had 40.", "context_url": "https://evil.example",
                  "sources": [{"url": "https://s.example/a", "quote": "40 participants", "junk": 1}]}';
begin
  -- Runs one call and answers 'ok' or the SQLSTATE it raised.
  execute $f$
    create function t182_code(p_sql text) returns text language plpgsql as $b$
    begin
      execute p_sql;
      return 'ok';
    exception when others then return sqlstate;
    end $b$ $f$;
  execute 'create function t182_headers(p_key text) returns void language sql as $b$ select set_config(''request.headers'', jsonb_build_object(''x-notewriter-key'', p_key)::text, true) $b$';

  update everything_items set status = 'done';
  insert into everything_items (id, url, status, full_text) values
    (post, 'https://blog.example/post', 'done', 'Researchers say   the study had 4,000 participants. It ran for a year. The drug was safe.'),
    (feed_post, 'https://blog.example/feed', 'queued', 'A feed post.');
  update everything_items set queued_at = now(), priority = 0 where id = feed_post;

  key := notewriter_admin_create('jackson-bot', 'Jackson''s notewriter', 'Jackson Hurley', 'jackson@example.com');
  r := r || jsonb_build_object(
    'key_looks_right', key ~ '^cnw_[0-9a-f]{64}$',
    'key_is_not_stored', not exists (select 1 from everything_notewriter_keys where key_hash = key),
    'new_writer_is_outside_and_reviewed', (select outside and review_first and notes_per_day = 20 and every_minutes is null
                                             from everything_notewriters where id = 'jackson-bot'));

  set local role anon;

  -- No key, a wrong key.
  r := r || jsonb_build_object('no_key_is_401', t182_code('select notewriter_api_me()') = 'PT401');
  perform t182_headers('cnw_wrong');
  r := r || jsonb_build_object('wrong_key_is_401', t182_code('select notewriter_api_me()') = 'PT401');
  perform t182_headers(key);

  r := r || jsonb_build_object(
    'me_names_the_writer', notewriter_api_me() #>> '{notewriter,id}' = 'jackson-bot',
    'me_counts_notes_left', (notewriter_api_me() ->> 'notes_left')::int = 20,
    'post_by_address', notewriter_api_post('https://blog.example/post') ->> 'text' like 'Researchers say%',
    'unknown_post_is_404', t182_code($q$select notewriter_api_post('https://nowhere.example')$q$) = 'PT404',
    'anon_cannot_use_the_protocol', t182_code($q$select notewriter_add_note('jackson-bot', '00000000-0000-0000-0000-0000000001a1', '{}')$q$) = '42501',
    'anon_cannot_make_writers', t182_code($q$select notewriter_admin_create('x', 'x', 'x', 'x')$q$) = '42501',
    'anon_cannot_read_keys', t182_code('select count(*) from everything_notewriter_keys') = '42501');

  -- Notes that are refused store nothing.
  r := r || jsonb_build_object(
    'passage_not_in_post_is_400', t182_code(format('select notewriter_api_add_note(%L, %L)',
        good || '{"passage": "the study had 5,000 participants"}', post)) = 'PT400',
    'no_source_is_400', t182_code(format('select notewriter_api_add_note(%L, %L)', good || '{"sources": []}', post)) = 'PT400',
    'source_without_web_address_is_400', t182_code(format('select notewriter_api_add_note(%L, %L)',
        good || '{"sources": [{"url": "javascript:alert(1)"}]}', post)) = 'PT400',
    'long_note_is_400', t182_code(format('select notewriter_api_add_note(%L, %L)',
        good || jsonb_build_object('note', repeat('a', 1001)), post)) = 'PT400',
    'timing_must_be_a_number', t182_code(format('select notewriter_api_add_note(%L, %L)', good || '{"start_seconds": "soon"}', post)) = 'PT400',
    'post_not_read_is_404', t182_code(format('select notewriter_api_add_note(%L, null, %L)', good, 'https://nowhere.example')) = 'PT404');
  reset role;
  r := r || jsonb_build_object('refused_notes_store_nothing', not exists (select 1 from everything_notewriter_submissions));
  set local role anon;

  -- A good note waits for review, and no reader sees it yet.
  x := notewriter_api_add_note(good, null, 'https://blog.example/post');
  r := r || jsonb_build_object(
    'reviewed_writer_waits', x ->> 'kind' = 'waiting',
    'second_note_on_the_passage_is_409', t182_code(format('select notewriter_api_add_note(%L, %L)', good, post)) = 'PT409',
    'notes_lists_it_waiting', notewriter_api_notes() #>> '{0,status}' = 'waiting' and notewriter_api_notes() -> 0 -> 'note' = 'null');
  reset role;
  r := r || jsonb_build_object('waiting_note_is_not_on_the_site', not exists (select 1 from everything_notes where notewriter_id = 'jackson-bot'));

  -- An admin approves it.
  y := notewriter_admin_decide((x ->> 'submission')::uuid, true, 'nathan');
  r := r || jsonb_build_object(
    'approved_note_is_posted', y ->> 'kind' = 'posted',
    'note_names_its_writer', (select notewriter_id = 'jackson-bot' from everything_notes where id = (y ->> 'note')::uuid),
    'only_named_fields_reach_the_note', (select c.context_url = 'https://blog.example/post' from everything_claims c where c.id = (y ->> 'claim')::uuid)
       and (select count(*) = 1 and bool_and(url = 'https://s.example/a') from everything_note_sources where note_id = (y ->> 'note')::uuid),
    'deciding_twice_fails', t182_code(format('select notewriter_admin_decide(%L, true, %L)', x ->> 'submission', 'nathan')) = 'P0001');
  update everything_notes set helpful_count = 3 where id = (y ->> 'note')::uuid;
  set local role anon;
  r := r || jsonb_build_object('notes_shows_votes', notewriter_api_notes() #>> '{0,status}' = 'posted' and (notewriter_api_notes() #>> '{0,helpful}')::int = 3);
  reset role;

  -- A rejected note tells the writer why.
  set local role anon;
  x := notewriter_api_add_note(good || '{"passage": "It ran for a year."}', post);
  reset role;
  perform notewriter_admin_decide((x ->> 'submission')::uuid, false, 'nathan', 'The source does not say this');
  set local role anon;
  -- Inside one transaction every submission has the same time, so find it by its id.
  r := r || jsonb_build_object('rejection_carries_its_reason', (
    select n ->> 'status' = 'rejected' and n ->> 'reason' = 'The source does not say this'
      from jsonb_array_elements(notewriter_api_notes()) n where n ->> 'submission' = x ->> 'submission'));
  reset role;

  -- A trusted writer posts at once, up to its cap.
  update everything_notewriters set review_first = false, notes_per_day = 3 where id = 'jackson-bot';
  set local role anon;
  x := notewriter_api_add_note(good || '{"passage": "The drug was safe."}', post);
  r := r || jsonb_build_object(
    'trusted_writer_posts_at_once', x ->> 'kind' = 'posted',
    'cap_is_429', t182_code(format('select notewriter_api_add_note(%L, %L)', good || '{"passage": "Researchers say"}', post)) = 'PT429');
  reset role;
  update everything_notewriters set notes_per_day = 20 where id = 'jackson-bot';

  -- The queue: a slow share, never reader requests, only its own assignments.
  insert into everything_assignments (item_id, notewriter_id, reader_request, deadline)
  values ('00000000-0000-0000-0000-000000000001', 'claude-ai-box', false, now() + interval '1 hour') returning id into other_assignment;
  set local role anon;
  r := r || jsonb_build_object('faster_than_30_minutes_is_400', t182_code('select notewriter_api_subscribe(10)') = 'PT400');
  perform notewriter_api_subscribe(30);
  x := notewriter_api_next_post();
  r := r || jsonb_build_object(
    'subscribed_writer_gets_a_post', x ->> 'kind' = 'post' and x #>> '{item,id}' = feed_post::text,
    'anothers_assignment_is_403', t182_code(format('select notewriter_api_finish(%L)', other_assignment)) = 'PT403'
                                  and t182_code(format('select notewriter_api_fail(%L, %L)', other_assignment, 'x')) = 'PT403',
    'own_assignment_finishes', notewriter_api_finish((x ->> 'assignment')::uuid, '{"notes": 0}') ->> 'post' = 'done');
  reset role;
  r := r || jsonb_build_object('never_takes_reader_requests', (select every_minutes = 30 and not takes_reader_requests from everything_notewriters where id = 'jackson-bot'));

  -- The switch.
  perform notewriter_admin_switch('jackson-bot', false, 'Too many wrong notes');
  set local role anon;
  r := r || jsonb_build_object('switched_off_is_403', t182_code('select notewriter_api_me()') = 'PT403'
                                                      and t182_code(format('select notewriter_api_add_note(%L, %L)', good || '{"passage": "Researchers say"}', post)) = 'PT403');
  reset role;
  r := r || jsonb_build_object(
    'switched_off_leaves_the_queue', (select every_minutes is null from everything_notewriters where id = 'jackson-bot'),
    'its_notes_stay_up', (select count(*) = 2 from everything_notes where notewriter_id = 'jackson-bot'));
  perform notewriter_admin_switch('jackson-bot', true);

  -- A new key ends the old one.
  new_key := notewriter_admin_new_key('jackson-bot');
  set local role anon;
  r := r || jsonb_build_object('old_key_is_401', t182_code('select notewriter_api_me()') = 'PT401');
  perform t182_headers(new_key);
  r := r || jsonb_build_object('new_key_works', t182_code('select notewriter_api_me()') = 'ok');
  reset role;

  raise exception 'RESULTS %', r;
end;
$$;
