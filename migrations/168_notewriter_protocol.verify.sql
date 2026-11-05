-- Checks for migration 168, run after it against 168_notewriter_protocol.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Each result
-- should be true, and a null counts as a failure.
--
-- Inside one transaction now() never moves, so the checks move timestamps
-- back by hand where time would have passed.
do $$
declare
  r jsonb := '{}';
  x jsonb;
  claude_post jsonb;
  claude_request jsonb;
  friend_post jsonb;
  friend_second jsonb;
  a_item uuid := '00000000-0000-0000-0000-0000000000e1';
  b_item uuid := '00000000-0000-0000-0000-0000000000e2';
  c_item uuid := '00000000-0000-0000-0000-0000000000e3';
  video uuid := '00000000-0000-0000-0000-0000000000e4';
  request_item uuid := '00000000-0000-0000-0000-0000000000e5';
  taken uuid := '00000000-0000-0000-0000-000000000002';
  allowed boolean;
begin
  -- The SQL twin of passagesOverlap. passageRequests.test.ts checks the same
  -- rows against the TypeScript function.
  r := r || jsonb_build_object('passages_overlap_cases', (
    select bool_and(everything_passages_overlap(a, b) = expected) from (values
      ('The study had 40 participants.', 'the study had 40 participants', true),
      ('A short passage', 'This text holds A short passage inside it', true),
      ('  Spaces   and
 lines  count  as one ', 'spaces and lines count as one', true),
      ('The first forty characters are shared by both of these passages, then they part.', 'Elsewhere: the first forty characters are shared by both of these passages, and more.', true),
      ('Nothing in common here at all, not one long run.', 'Completely different words in this other sentence.', false),
      ('', 'anything', false)
    ) as t(a, b, expected)));

  -- Backfills.
  r := r || jsonb_build_object(
    'claude_note_backfilled', (select notewriter_id = 'claude-ai-box' from everything_notes where id = '00000000-0000-0000-0000-0000000000d1'),
    'pipeline_note_backfilled', (select notewriter_id = 'pipeline' from everything_notes where id = '00000000-0000-0000-0000-0000000000d2'),
    'person_note_untouched', (select notewriter_id is null from everything_notes where id = '00000000-0000-0000-0000-0000000000d3'),
    'taken_post_has_open_assignment', (select count(*) = 1 from everything_assignments where item_id = taken and notewriter_id = 'claude-ai-box' and ended_at is null),
    'queued_at_backfilled', (select queued_at is not null from everything_items where id = taken));

  -- Two notewriters, as in the plan's worked example.
  update everything_notewriters set every_minutes = 30 where id = 'claude-ai-box';
  insert into everything_notewriters (id, name, owner, every_minutes, lease_minutes) values ('friend-bot', 'Friend', 'A friend', 20, 60);
  insert into everything_items (id, url, full_text, published_at, project_id) values
    (a_item, 'https://a.example', 'Post A says the study had 40 participants.', '2026-11-04', '00000000-0000-0000-0000-0000000000a1'),
    (b_item, 'https://b.example', 'Post B text', '2026-11-03', null),
    (c_item, 'https://c.example', 'Post C text', '2026-11-02', null);
  insert into everything_items (id, url, source, full_text, published_at) values (video, 'https://youtube.example/v', 'youtube', 'Video text', '2026-11-05');
  insert into everything_items (id, url, full_text, priority) values (request_item, 'https://requested.example', 'Requested text', 2);
  -- The taken post is no feed post the example needs.
  update everything_items set status = 'done' where id = taken;
  update everything_assignments set ended_at = now(), outcome = 'done' where item_id = taken;

  r := r || jsonb_build_object('wanted_two_waiting_four', (select wanted = 2 and waiting = 4 from notewriter_feed_posts_wanted()));

  -- Claude takes reader requests, so it gets the request first, and then a
  -- feed post. The video has no caption timings yet, so nobody gets it.
  claude_request := notewriter_next_post('claude-ai-box');
  claude_post := notewriter_next_post('claude-ai-box');
  r := r || jsonb_build_object(
    'request_first', (claude_request -> 'item' ->> 'id')::uuid = request_item and (claude_request ->> 'reader_request')::boolean,
    'then_newest_prepared_feed_post', (claude_post -> 'item' ->> 'id')::uuid = a_item,
    'post_carries_text_and_creator', claude_post -> 'item' ->> 'text' = 'Post A says the study had 40 participants.' and claude_post -> 'item' ->> 'creator' = 'Astral Codex Ten',
    'lease_of_three_hours', ((claude_post ->> 'deadline')::timestamptz - now()) = interval '180 minutes',
    'handout_sets_alarm', (select next_run_at = now() and next_run_reason = 'handout' from everything_feed_schedule),
    'claude_not_due', notewriter_next_post('claude-ai-box') ->> 'reason' = 'not_due');

  friend_post := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object(
    'friend_gets_next_post', (friend_post -> 'item' ->> 'id')::uuid = b_item,
    'friend_gets_no_request', not (friend_post ->> 'reader_request')::boolean);

  -- Notes.
  x := notewriter_add_note('friend-bot', b_item, '{"passage": "Post B", "note": "B is wrong.", "sources": [{"url": "https://s.example", "quote": "q"}]}');
  r := r || jsonb_build_object(
    'note_posted', x ->> 'kind' = 'posted',
    'note_carries_notewriter', (select notewriter_id = 'friend-bot' from everything_notes where id = (x ->> 'note')::uuid),
    'note_has_source', (select count(*) = 1 from everything_note_sources where note_id = (x ->> 'note')::uuid));
  begin
    perform notewriter_add_note('friend-bot', b_item, '{"passage": "Post B", "note": "No sources", "sources": []}');
    allowed := true;
  exception when raise_exception then allowed := false;
  end;
  r := r || jsonb_build_object('note_needs_source', not allowed);
  insert into everything_claims (id, item_id, claim, judgement, context_quote) values ('00000000-0000-0000-0000-0000000000c9', c_item, 'Post C text', 'user', 'Post C text');
  insert into everything_notes (claim_id, note, author_id, author_name) values ('00000000-0000-0000-0000-0000000000c9', 'Jim wrote this', '00000000-0000-0000-0000-00000000000a', 'Jim');
  x := notewriter_add_note('friend-bot', c_item, '{"passage": "Post C text", "note": "Again", "sources": [{"url": "https://s.example"}]}');
  r := r || jsonb_build_object('person_note_blocks_ai_note', x ->> 'kind' = 'not_posted' and x ->> 'reason' = 'Jim already wrote a note on this passage');

  -- friend-bot fails on B: a 15-minute break, and B waits for Claude.
  x := notewriter_fail((friend_post ->> 'assignment')::uuid, 'OpenRouter answered 502');
  r := r || jsonb_build_object(
    'first_break_15_minutes', (x ->> 'cooldown_until')::timestamptz = now() + interval '15 minutes',
    'post_back_in_queue', x ->> 'post' = 'back_in_queue' and (select status = 'queued' from everything_items where id = b_item),
    'friend_on_break', notewriter_next_post('friend-bot') ->> 'kind' = 'cooldown');

  -- After its break and its interval, friend-bot gets C, not B again.
  update everything_notewriters set cooldown_until = now() - interval '1 second' where id = 'friend-bot';
  update everything_assignments set started_at = now() - interval '1 hour' where notewriter_id = 'friend-bot';
  -- B waits, but friend-bot failed on it, so it does not count as friend-bot's
  -- waiting post. C and the unread video do.
  r := r || jsonb_build_object('failed_post_not_counted_as_waiting', (select wanted = 2 and waiting = 2 from notewriter_feed_posts_wanted()));
  friend_second := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object('failed_post_not_given_again', (friend_second -> 'item' ->> 'id')::uuid = c_item);

  -- Claude, once due, gets B. When Claude fails on it too, nobody is left.
  update everything_assignments set started_at = now() - interval '1 hour' where notewriter_id = 'claude-ai-box';
  x := notewriter_next_post('claude-ai-box');
  r := r || jsonb_build_object('claude_gets_failed_post', (x -> 'item' ->> 'id')::uuid = b_item);
  x := notewriter_fail((x ->> 'assignment')::uuid, 'Claude exited twice without a report');
  r := r || jsonb_build_object(
    'post_fails_when_nobody_left', x ->> 'post' = 'failed' and (select status = 'error' from everything_items where id = b_item));

  -- friend-bot's deadline on C passes: the post is taken back, and the second
  -- failure in a row gives a 30-minute break.
  update everything_assignments set deadline = now() - interval '1 second' where id = (friend_second ->> 'assignment')::uuid;
  perform notewriter_next_post('claude-ai-box');
  r := r || jsonb_build_object(
    'expired_assignment', (select outcome = 'expired' from everything_assignments where id = (friend_second ->> 'assignment')::uuid),
    'second_break_30_minutes', (select failures_in_a_row = 2 and cooldown_until = now() + interval '30 minutes' from everything_notewriters where id = 'friend-bot'));

  -- Claude finishes A. A passage request from before the hand-out gets its
  -- answer. One from after puts the post back in the queue.
  insert into everything_note_requests (item_id, status, status_reason, selection, created_at) values
    (a_item, 'enqueued', 'checking the selected passage', 'the study had 40 participants', now() - interval '2 hours'),
    (a_item, 'enqueued', 'checking the selected passage', 'a later question', now() + interval '1 minute');
  perform notewriter_add_note('claude-ai-box', a_item, '{"passage": "Post A says the study had 40 participants.", "note": "It had 4,000.", "sources": [{"url": "https://s.example"}]}');
  -- A's assignment was moved back an hour above, and its note was written now.
  x := notewriter_finish((claude_post ->> 'assignment')::uuid, '{"notes": 1}');
  r := r || jsonb_build_object(
    'request_answered_with_note', (select status = 'done' and status_reason = 'the selected passage got a note' from everything_note_requests where selection = 'the study had 40 participants'),
    'later_request_requeues', x ->> 'post' = 'back_in_queue' and (select status = 'queued' from everything_items where id = a_item),
    'finish_resets_failures', (select failures_in_a_row = 0 and cooldown_until is null from everything_notewriters where id = 'claude-ai-box'));
  begin
    perform notewriter_finish((claude_post ->> 'assignment')::uuid);
    allowed := true;
  exception when raise_exception then allowed := false;
  end;
  r := r || jsonb_build_object('finish_only_once', not allowed);

  x := notewriter_finish((claude_request ->> 'assignment')::uuid, null, 'Nothing worth checking');
  r := r || jsonb_build_object(
    'skip_marks_done_with_reason', (select status = 'done' and skip_reason = 'Nothing worth checking' from everything_items where id = request_item),
    'skip_outcome', (select outcome = 'skipped' from everything_assignments where id = (claude_request ->> 'assignment')::uuid));

  -- Subscribing and status.
  x := notewriter_subscribe('claude-ai-box', null);
  r := r || jsonb_build_object(
    'unsubscribe_keeps_requests', (x ->> 'every_minutes') is null and (x ->> 'takes_reader_requests')::boolean,
    'unsubscribed_waits', notewriter_next_post('claude-ai-box') ->> 'reason' = 'unsubscribed',
    'status_lists_failures', jsonb_array_length(notewriter_status('friend-bot') -> 'last_failures') = 2);

  -- The video gets a notewriter once the intake service stored its timings.
  update everything_items set caption_cues = '[]' where id = video;
  update everything_notewriters set cooldown_until = null where id = 'friend-bot';
  update everything_assignments set started_at = now() - interval '2 hours' where notewriter_id = 'friend-bot';
  r := r || jsonb_build_object('prepared_video_handed_out', (notewriter_next_post('friend-bot') -> 'item' ->> 'id')::uuid = video);

  -- With no feed post waiting, a due notewriter is told to ask again in a minute.
  update everything_items set status = 'done' where status = 'queued';
  update everything_assignments set started_at = now() - interval '2 hours' where notewriter_id = 'friend-bot';
  x := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object('empty_queue_says_when', x ->> 'reason' = 'queue_empty' and (x ->> 'until')::timestamptz = now() + interval '1 minute');

  -- Claude's drafts are posted through notewriter_add_note.
  insert into everything_claude_drafts (id, item_id, passage, note, sources, status)
  values ('00000000-0000-0000-0000-0000000000f1', c_item, 'A different passage of C', 'Claude on C', '[{"url": "https://s.example"}]', 'posting');
  x := to_jsonb(everything_claude_publish('00000000-0000-0000-0000-0000000000f1', 'ai', 'claude'));
  r := r || jsonb_build_object('claude_publish_uses_protocol', (select notewriter_id = 'claude-ai-box' from everything_notes where id = (x #>> '{}')::uuid));

  -- The anon key cannot call the protocol, and only admins see the overview.
  set local role anon;
  begin
    perform notewriter_next_post('friend-bot');
    allowed := true;
  exception when insufficient_privilege then allowed := false;
  end;
  reset role;
  r := r || jsonb_build_object('anon_cannot_call', not allowed);
  set local role authenticated;
  begin
    perform * from everything_notewriters_overview();
    allowed := true;
  exception when raise_exception then allowed := false;
  end;
  perform set_config('test.admin', 'true', true);
  r := r || jsonb_build_object('non_admin_refused', not allowed,
                               'admin_sees_overview', (select count(*) = 3 from everything_notewriters_overview()));
  reset role;

  raise exception 'RESULTS %', r;
end;
$$;
