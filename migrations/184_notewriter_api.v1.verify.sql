-- Migration 168's checks, run against API v1 as migration 184 rebuilt it on
-- top of the reservations (the commands are at the top of
-- 184_notewriter_api.fixture.sql). This is a copy of
-- 168_notewriter_protocol.verify.sql, and every line that differs is marked
-- "Changed in 184" with the reason. `diff` the two files to see all of it.
-- The changes are the ones the plan names: no breaks after failures, a note
-- needs the post held, and the checks every note gets now. The block ends by
-- raising an error that carries every result, so nothing it wrote stays. Each
-- result should be true, and a null counts as a failure.
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

  -- Changed in 184: the posts migration 184's fixture adds, the done post and
  -- the post Claude held at the switch would be listed. 168's queue skipped
  -- them because they were not queued, or were held.
  update everything_items set full_text = null
   where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
                '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005');

  -- Two notewriters, as in the plan's worked example.
  update everything_notewriters set every_minutes = 30 where id = 'claude-ai-box';
  insert into everything_notewriters (id, name, owner, every_minutes, lease_minutes) values ('friend-bot', 'Friend', 'A friend', 20, 60);
  insert into everything_items (id, url, full_text, published_at, project_id) values
    -- Changed in 184: only the last 14 days are listed, so the days are
    -- counted back from today. And a passage needs 20 characters that are in
    -- the post, so the texts are longer.
    (a_item, 'https://a.example', 'Post A says the study had 40 participants.', current_date - 1, '00000000-0000-0000-0000-0000000000a1'),
    (b_item, 'https://b.example', 'Post B says the bridge was built in 1850.', current_date - 2, null),
    (c_item, 'https://c.example', 'Post C text has a passage Jim wrote a note on. A different passage of C is here too.', current_date - 3, null);
  insert into everything_items (id, url, source, full_text, published_at) values (video, 'https://youtube.example/v', 'youtube', 'Video text', current_date);
  insert into everything_items (id, url, full_text, priority) values (request_item, 'https://requested.example', 'Requested text', 2);
  -- The taken post is no feed post the example needs.
  update everything_items set status = 'done', full_text = null where id = taken;
  update everything_assignments set ended_at = now(), outcome = 'done' where item_id = taken;
  -- Changed in 184: the held post's assignment is a reservation now.
  update everything_reservations set ended_at = now(), outcome = 'done' where item_id = taken;

  -- Changed in 184: a post counts as waiting once it is listed, which needs a
  -- video's caption timings. 168 counted the unread video too.
  r := r || jsonb_build_object('wanted_two_waiting_three', (select wanted = 2 and waiting = 3 from notewriter_feed_posts_wanted()));

  -- Claude takes reader requests, so it gets the request first, and then a
  -- feed post. The video has no caption timings yet, so nobody gets it.
  claude_request := notewriter_next_post('claude-ai-box');
  claude_post := notewriter_next_post('claude-ai-box');
  r := r || jsonb_build_object(
    'request_first', (claude_request -> 'item' ->> 'id')::uuid = request_item and (claude_request ->> 'reader_request')::boolean,
    'then_newest_prepared_feed_post', (claude_post -> 'item' ->> 'id')::uuid = a_item,
    'post_carries_text_and_creator', claude_post -> 'item' ->> 'text' = 'Post A says the study had 40 participants.' and claude_post -> 'item' ->> 'creator' = 'Astral Codex Ten',
    'lease_of_three_hours', ((claude_post ->> 'deadline')::timestamptz - now()) = interval '180 minutes',
    -- Changed in 184: cn-walk adds new posts, so a hand-out no longer starts
    -- a feed run.
    'handout_leaves_alarm', (select next_run_reason = 'idle' from everything_feed_schedule),
    'claude_not_due', notewriter_next_post('claude-ai-box') ->> 'reason' = 'not_due');

  friend_post := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object(
    'friend_gets_next_post', (friend_post -> 'item' ->> 'id')::uuid = b_item,
    'friend_gets_no_request', not (friend_post ->> 'reader_request')::boolean);

  -- Notes.
  -- Changed in 184: a passage has at least 20 characters.
  x := notewriter_add_note('friend-bot', b_item, '{"passage": "Post B says the bridge was built", "note": "B is wrong.", "sources": [{"url": "https://s.example", "quote": "q"}]}');
  r := r || jsonb_build_object(
    'note_posted', x ->> 'kind' = 'posted',
    'note_carries_notewriter', (select notewriter_id = 'friend-bot' from everything_notes where id = (x ->> 'note')::uuid),
    'note_has_source', (select count(*) = 1 from everything_note_sources where note_id = (x ->> 'note')::uuid));
  begin
    perform notewriter_add_note('friend-bot', b_item, '{"passage": "the bridge was built in 1850", "note": "No sources", "sources": []}');
    allowed := true;
  -- Changed in 184: refusals carry the API's error codes (PT400 here).
  exception when others then allowed := false;
  end;
  r := r || jsonb_build_object('note_needs_source', not allowed);
  insert into everything_claims (id, item_id, claim, judgement, context_quote) values ('00000000-0000-0000-0000-0000000000c9', c_item, 'Post C text has a passage Jim wrote a note on', 'user', 'Post C text has a passage Jim wrote a note on');
  insert into everything_notes (claim_id, note, author_id, author_name) values ('00000000-0000-0000-0000-0000000000c9', 'Jim wrote this', '00000000-0000-0000-0000-00000000000a', 'Jim');
  -- Changed in 184: a note needs the post held. friend-bot holds B, not C.
  -- The person's note is checked below, once friend-bot holds C.
  begin
    perform notewriter_add_note('friend-bot', c_item, '{"passage": "Post C text has a passage Jim wrote a note on", "note": "Again", "sources": [{"url": "https://s.example"}]}');
    allowed := true;
  exception when others then allowed := false;
  end;
  r := r || jsonb_build_object('note_needs_post_held', not allowed);

  -- friend-bot fails on B, and B waits for Claude.
  x := notewriter_fail((friend_post ->> 'assignment')::uuid, 'OpenRouter answered 502');
  r := r || jsonb_build_object(
    -- Changed in 184: no breaks. friend-bot waits for its interval only.
    'no_break', x -> 'cooldown_until' = 'null',
    'post_back_in_queue', x ->> 'post' = 'back_in_queue' and (select status = 'queued' from everything_items where id = b_item),
    'friend_not_due', notewriter_next_post('friend-bot') ->> 'reason' = 'not_due');

  -- After its break and its interval, friend-bot gets C, not B again.
  update everything_notewriters set cooldown_until = now() - interval '1 second' where id = 'friend-bot';
  update everything_assignments set started_at = now() - interval '1 hour' where notewriter_id = 'friend-bot';
  -- Changed in 184: the assignments are reservations now.
  update everything_reservations set started_at = now() - interval '1 hour' where notewriter_id = 'friend-bot';
  -- Changed in 184: B and C wait, because nobody counts on either. A failed
  -- post stays listed for everyone except the notewriter that failed.
  r := r || jsonb_build_object('failed_post_still_waiting', (select wanted = 2 and waiting = 2 from notewriter_feed_posts_wanted()));
  friend_second := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object('failed_post_not_given_again', (friend_second -> 'item' ->> 'id')::uuid = c_item);
  -- Changed in 184: moved here from above, where friend-bot did not hold C.
  x := notewriter_add_note('friend-bot', c_item, '{"passage": "Post C text has a passage Jim wrote a note on", "note": "Again", "sources": [{"url": "https://s.example"}]}');
  r := r || jsonb_build_object('person_note_blocks_ai_note', x ->> 'kind' = 'not_posted' and x ->> 'reason' = 'Jim already wrote a note on this passage');

  -- Claude, once due, gets B.
  update everything_assignments set started_at = now() - interval '1 hour' where notewriter_id = 'claude-ai-box';
  -- Changed in 184: the assignments are reservations now.
  update everything_reservations set started_at = now() - interval '1 hour' where notewriter_id = 'claude-ai-box';
  x := notewriter_next_post('claude-ai-box');
  r := r || jsonb_build_object('claude_gets_failed_post', (x -> 'item' ->> 'id')::uuid = b_item);
  x := notewriter_fail((x ->> 'assignment')::uuid, 'Claude exited twice without a report');
  -- Changed in 184: a feed post never fails as a whole. It stays listed for
  -- any notewriter that has not failed on it, such as one added later.
  r := r || jsonb_build_object(
    'feed_post_stays_when_nobody_left', x ->> 'post' = 'back_in_queue' and (select status = 'queued' from everything_items where id = b_item));

  -- friend-bot's deadline on C passes: the post is taken back.
  -- Changed in 184: the reservation's deadline. cn-walk ends it every 5
  -- minutes through notewriter_tidy_list, which take_back_overdue now calls.
  -- There is no break after it.
  update everything_reservations set deadline = now() - interval '1 second' where id = (friend_second ->> 'assignment')::uuid;
  perform notewriter_take_back_overdue();
  r := r || jsonb_build_object(
    'expired_assignment', (select outcome = 'expired' from everything_reservations where id = (friend_second ->> 'assignment')::uuid));

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
    -- Changed in 184: there are no failures in a row to reset.
    'later_request_requeues', x ->> 'post' = 'back_in_queue' and (select status = 'queued' from everything_items where id = a_item));
  begin
    perform notewriter_finish((claude_post ->> 'assignment')::uuid);
    allowed := true;
  -- Changed in 184: refusals carry the API's error codes (PT409 here).
  exception when others then allowed := false;
  end;
  r := r || jsonb_build_object('finish_only_once', not allowed);

  x := notewriter_finish((claude_request ->> 'assignment')::uuid, null, 'Nothing worth checking');
  r := r || jsonb_build_object(
    'skip_marks_done_with_reason', (select status = 'done' and skip_reason = 'Nothing worth checking' from everything_items where id = request_item),
    -- Changed in 184: the assignments are reservations now.
    'skip_outcome', (select outcome = 'skipped' from everything_reservations where id = (claude_request ->> 'assignment')::uuid));

  -- Subscribing and status.
  x := notewriter_subscribe('claude-ai-box', null);
  r := r || jsonb_build_object(
    'unsubscribe_keeps_requests', (x ->> 'every_minutes') is null and (x ->> 'takes_reader_requests')::boolean,
    -- Changed in 184: the passage request that came in while Claude held A
    -- makes A a requested post, so Claude, which takes reader requests, gets
    -- it first. In 168 it went back to A's own tier of the queue.
    'later_request_handed_out_first', (notewriter_next_post('claude-ai-box') -> 'item' ->> 'id')::uuid = a_item,
    'unsubscribed_waits', notewriter_next_post('claude-ai-box') ->> 'reason' = 'unsubscribed',
    'status_lists_failures', jsonb_array_length(notewriter_status('friend-bot') -> 'last_failures') = 2);

  -- The video gets a notewriter once the intake service stored its timings.
  update everything_items set caption_cues = '[]' where id = video;
  update everything_notewriters set cooldown_until = null where id = 'friend-bot';
  update everything_assignments set started_at = now() - interval '2 hours' where notewriter_id = 'friend-bot';
  -- Changed in 184: the assignments are reservations now.
  update everything_reservations set started_at = now() - interval '2 hours' where notewriter_id = 'friend-bot';
  r := r || jsonb_build_object('prepared_video_handed_out', (notewriter_next_post('friend-bot') -> 'item' ->> 'id')::uuid = video);

  -- With no feed post waiting, a due notewriter is told to ask again in a minute.
  -- Changed in 184: a done post stays listed. The list is empty for
  -- friend-bot when every post was looked at or failed by it.
  update everything_items set status = 'done' where status = 'queued';
  update everything_reservations set ended_at = now(), outcome = 'done' where item_id = a_item and ended_at is null;
  update everything_items set full_text = null where id = b_item;
  update everything_reservations set started_at = now() - interval '2 hours' where notewriter_id = 'friend-bot';
  x := notewriter_next_post('friend-bot');
  r := r || jsonb_build_object('empty_queue_says_when', x ->> 'reason' = 'queue_empty' and (x ->> 'until')::timestamptz = now() + interval '1 minute');

  -- Claude's drafts are posted through notewriter_add_note.
  insert into everything_claude_drafts (id, item_id, passage, note, sources, status)
  values ('00000000-0000-0000-0000-0000000000f1', c_item, 'A different passage of C', 'Claude on C', '[{"url": "https://s.example"}]', 'posting');
  x := to_jsonb(everything_claude_publish('00000000-0000-0000-0000-0000000000f1', 'ai', 'claude'));
  -- Changed in 184: the note goes to the notewriter of the post's last
  -- reservation, which is friend-bot's expired one on C. 168 used
  -- claude-ai-box for every draft.
  r := r || jsonb_build_object('claude_publish_uses_protocol', (select notewriter_id = 'friend-bot' from everything_notes where id = (x #>> '{}')::uuid));

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
                               -- Changed in 184: claude-devbox is new.
                               'admin_sees_overview', (select count(*) = 4 from everything_notewriters_overview()));
  reset role;

  raise exception 'RESULTS %', r;
end;
$$;
