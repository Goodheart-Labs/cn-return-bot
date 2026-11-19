-- Checks for migration 184, run after it against its fixture (the commands
-- are at the top of 184_notewriter_api.fixture.sql). The block ends by raising
-- an error that carries every result, so nothing it wrote stays. Each result
-- should be true, and a null counts as a failure.
--
-- Inside one transaction now() never moves, so the checks move timestamps
-- back by hand where time would have passed.

-- The SQLSTATE a statement raises, or null when it succeeds. Each call is a
-- savepoint, so a refused call leaves nothing behind.
create or replace function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;

-- Calls the API as the notewriter with this key, as PostgREST passes the header.
create or replace function pg_temp.as_key(p_key text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-notewriter-key', p_key)::text, true)
$$;

do $$
declare
  r jsonb := '{}';
  x jsonb;
  y jsonb;
  page jsonb;
  devbox_key text;
  hq_key text;
  out_key text;
  acx uuid := '00000000-0000-0000-0000-0000000000a1';
  low uuid := '00000000-0000-0000-0000-0000000000a2';
  acx_today uuid := '00000000-0000-0000-0000-0000000001a1';
  low_today uuid := '00000000-0000-0000-0000-0000000001a2';
  acx_old uuid := '00000000-0000-0000-0000-0000000001a3';
  requested uuid := '00000000-0000-0000-0000-000000000003';
  taken uuid := '00000000-0000-0000-0000-000000000002';
  demanded uuid := '00000000-0000-0000-0000-000000000005';
  res_hq uuid;
  res_out uuid;
  res_dev uuid;
  ids uuid[];
  note_count int;
begin
  -- The backfill.
  r := r || jsonb_build_object(
    'assignment_copied_with_its_id', (select count(*) = 1 from everything_reservations res join everything_assignments a on a.id = res.id where res.ended_at is null),
    'held_post_counts_once', (select list_team_count = 1 and list_all_count = 1 from everything_items where id = taken),
    'old_request_is_requested', (select list_requested and list_open from everything_items where id = requested),
    'old_post_not_listed', (select not list_open from everything_items where id = '00000000-0000-0000-0000-000000000004'),
    'demanded_page_ranks_as_priority', (select list_rank = 1000 and list_open from everything_items where id = demanded),
    'lease_default_120', (select lease_minutes = 120 from everything_notewriters where id = 'pipeline'));

  -- The plan's worked example: Astral Codex Ten with a high score, a channel
  -- with score 1.3, and an ACX post from 3 days ago.
  update everything_projects set feed_url = 'https://www.astralcodexten.com' where id = acx;
  insert into everything_projects (id, name, feed_url) values (low, 'A channel', 'https://www.youtube.com/channel/UCx');
  r := r || jsonb_build_object('ranks_set', notewriter_set_list_ranks('[{"feed_url": "https://www.AstralCodexTen.com", "rank": 3.9}, {"feed_url": "https://www.youtube.com/channel/UCx", "rank": 1.3}]') = 2);
  insert into everything_items (id, project_id, url, full_text, published_at, source) values
    (acx_today, acx, 'https://acx.example/today', 'Today ACX says the study had 40 participants, which is a claim worth checking.', current_date, 'substack'),
    (low_today, low, 'https://low.example/today', 'The channel says the bridge was built in 1850, which is a claim worth checking.', current_date, 'substack'),
    (acx_old, acx, 'https://acx.example/old', 'Three days ago ACX said the drug halved deaths, which is a claim worth checking.', current_date - 3, 'substack');
  -- Nothing else in the fixture should get in the example's way.
  update everything_assignments set ended_at = now(), outcome = 'done' where item_id = taken;
  update everything_reservations set ended_at = now(), outcome = 'done' where item_id = taken;
  update everything_items set demanded_at = null, published_at = current_date - 30 where id = demanded;
  update everything_items set full_text = null where id in ('00000000-0000-0000-0000-000000000001', taken);

  -- Keys.
  devbox_key := notewriter_admin_new_key('claude-devbox');
  insert into everything_notewriters (id, name, owner) values ('claude-hq-nathan', 'Claude on hq', 'nathan');
  hq_key := notewriter_admin_new_key('claude-hq-nathan');
  out_key := notewriter_admin_create('jackson-hurley', 'Jackson''s notewriter', 'Jackson', 'jackson@example.com');
  perform set_config('request.headers', '{}', true);
  r := r || jsonb_build_object(
    'no_key_401', pg_temp.sqlstate_of('select notewriter_api_me()') = 'PT401',
    'key_stored_as_hash_only', (select count(*) = 0 from everything_notewriter_keys where key_hash = devbox_key));
  perform pg_temp.as_key('cnw_wrong');
  r := r || jsonb_build_object('wrong_key_401', pg_temp.sqlstate_of('select notewriter_api_me()') = 'PT401');

  -- The order: requested, fewer reservations, rank, newer.
  perform pg_temp.as_key(devbox_key);
  x := notewriter_api_me();
  r := r || jsonb_build_object(
    'me_names_notewriter', x -> 'notewriter' ->> 'id' = 'claude-devbox',
    'me_no_limits_for_team', x -> 'limits' -> 'notes_per_day' = 'null' and x -> 'notes_left' = 'null',
    'me_is_sign_of_life', (select last_seen_at = now() from everything_notewriters where id = 'claude-devbox'));
  page := notewriter_api_posts(10);
  select array_agg((p ->> 'id')::uuid order by n) into ids from jsonb_array_elements(page -> 'posts') with ordinality t(p, n);
  r := r || jsonb_build_object(
    'order_requested_rank_date', ids = array[requested, acx_today, acx_old, low_today],
    'listing_shows_requested', (page -> 'posts' -> 0 ->> 'requested')::boolean,
    'listing_shows_creator', page -> 'posts' -> 1 ->> 'creator' = 'Astral Codex Ten' and (page -> 'posts' -> 1 ->> 'creator_score')::numeric = 3.9,
    'short_page_has_no_next', page -> 'next' = 'null');

  -- Paging: two posts, then the rest, with no post twice.
  page := notewriter_api_posts(2);
  y := notewriter_api_posts(10, page -> 'next');
  r := r || jsonb_build_object(
    'page_two_continues', (select array_agg((p ->> 'id')::uuid order by n) from jsonb_array_elements((page -> 'posts') || (y -> 'posts')) with ordinality t(p, n))
                          = array[requested, acx_today, acx_old, low_today]);

  -- Reserving. The outside notewriter reserves the top ACX post first.
  perform pg_temp.as_key(out_key);
  r := r || jsonb_build_object('outside_not_listed_requested', (notewriter_api_posts(1) -> 'posts' -> 0 ->> 'id')::uuid = acx_today);
  x := notewriter_api_reserve(acx_today);
  res_out := (x ->> 'reservation')::uuid;
  r := r || jsonb_build_object('outside_reserves_place_1', x ->> 'kind' = 'reserved' and (x ->> 'place')::int = 1
                               and x -> 'post' ->> 'text' like 'Today ACX%'
                               and ((x ->> 'deadline')::timestamptz - now()) = interval '120 minutes');

  -- Everyone's count hides it, the team's count does not.
  perform pg_temp.as_key(devbox_key);
  r := r || jsonb_build_object(
    'everyone_listing_hides_it', not exists (select 1 from jsonb_array_elements(notewriter_api_posts(10) -> 'posts') p where (p ->> 'id')::uuid = acx_today),
    'team_listing_shows_it', (notewriter_api_posts(1, null, 0, 'team', false) -> 'posts' -> 0 ->> 'id')::uuid = requested
                             and exists (select 1 from jsonb_array_elements(notewriter_api_posts(10, null, 0, 'team') -> 'posts') p where (p ->> 'id')::uuid = acx_today));
  x := notewriter_api_reserve(acx_today);
  res_dev := (x ->> 'reservation')::uuid;
  r := r || jsonb_build_object('team_reserves_place_2', x ->> 'kind' = 'reserved' and (x ->> 'place')::int = 2);

  -- hq loses the race: one team reservation counts, at_most 1 is taken.
  perform pg_temp.as_key(hq_key);
  x := notewriter_api_reserve(acx_today, 1);
  r := r || jsonb_build_object(
    'second_team_reserve_taken', x ->> 'kind' = 'taken' and (x ->> 'reservations')::int = 1,
    'first_or_second_fine', notewriter_api_reserve(acx_today, 2) ->> 'kind' = 'reserved',
    'one_open_per_notewriter_409', pg_temp.sqlstate_of(format('select notewriter_api_reserve(%L, 5)', acx_today)) = 'PT409',
    'no_such_post_404', pg_temp.sqlstate_of('select notewriter_api_reserve(''00000000-0000-0000-0000-00000000ffff'')') = 'PT404');
  res_hq := (select id from everything_reservations where item_id = acx_today and notewriter_id = 'claude-hq-nathan' and ended_at is null);

  -- Notes need a reservation of one's own that is open.
  perform pg_temp.as_key(devbox_key);
  select count(*) into note_count from everything_notes;
  r := r || jsonb_build_object(
    'note_on_others_reservation_403', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 40 participants", "note": "It had 4,000.", "sources": [{"url": "https://s.example"}]}')$q$, res_hq)) = 'PT403',
    'v1_note_without_reservation_403', pg_temp.sqlstate_of(format($q$select notewriter_add_note('pipeline', %L, '{"passage": "the study had 40 participants", "note": "It had 4,000.", "sources": [{"url": "https://s.example"}]}')$q$, acx_today)) = 'PT403',
    'short_passage_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "40 participants", "note": "n", "sources": [{"url": "https://s.example"}]}')$q$, res_dev)) = 'PT400',
    'passage_not_in_post_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 5,000 participants", "note": "n", "sources": [{"url": "https://s.example"}]}')$q$, res_dev)) = 'PT400',
    'sources_object_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 40 participants", "note": "n", "sources": {"url": "https://s.example"}}')$q$, res_dev)) = 'PT400',
    'source_without_web_address_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 40 participants", "note": "n", "sources": [{"url": "javascript:alert(1)"}]}')$q$, res_dev)) = 'PT400',
    'long_note_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, jsonb_build_object('passage', 'the study had 40 participants', 'note', repeat('x', 1001), 'sources', '[{"url": "https://s.example"}]'::jsonb))$q$, res_dev)) = 'PT400',
    'timing_on_text_post_400', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 40 participants", "note": "n", "start_seconds": 12, "sources": [{"url": "https://s.example"}]}')$q$, res_dev)) = 'PT400',
    'refused_notes_store_nothing', (select count(*) from everything_notes) = note_count);
  x := notewriter_api_add_note(res_dev, '{"passage": "the study had  40 PARTICIPANTS", "note": "It had 4,000.", "sources": [{"url": "HTTPS://s.example", "quote": "q"}], "notewriter_id": "someone-else"}');
  r := r || jsonb_build_object(
    'note_posted', x ->> 'kind' = 'posted',
    'note_is_the_reservations_notewriter', (select notewriter_id = 'claude-devbox' from everything_notes where id = (x ->> 'note')::uuid),
    'own_passage_again_409', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "the study had 40 participants", "note": "Again", "sources": [{"url": "https://s.example"}]}')$q$, res_dev)) = 'PT409');

  -- First note wins: the outside notewriter's note on the same passage.
  perform pg_temp.as_key(out_key);
  x := notewriter_api_add_note(res_out, '{"passage": "Today ACX says the study had 40 participants", "note": "Wrong.", "sources": [{"url": "https://s.example"}]}');
  r := r || jsonb_build_object('second_note_on_passage_not_posted', x ->> 'kind' = 'not_posted' and x ->> 'reason' = 'Another notewriter already wrote a note on this passage');

  -- Limits of an outside notewriter.
  update everything_notewriters set notes_per_day = 1 where id = 'jackson-hurley';
  insert into everything_claims (id, item_id, claim, judgement, context_quote) values ('00000000-0000-0000-0000-0000000002c1', acx_old, 'An unrelated passage of the old post', 'notewriter', 'An unrelated passage of the old post');
  insert into everything_notes (claim_id, note, notewriter_id) values ('00000000-0000-0000-0000-0000000002c1', 'An earlier note', 'jackson-hurley');
  r := r || jsonb_build_object(
    'daily_cap_429', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "which is a claim worth checking", "note": "n", "sources": [{"url": "https://s.example"}]}')$q$, res_out)) = 'PT429',
    'me_counts_notes_left', (notewriter_api_me() ->> 'notes_left')::int = 0);
  perform notewriter_api_reserve(low_today);
  r := r || jsonb_build_object('max_open_429', pg_temp.sqlstate_of(format('select notewriter_api_reserve(%L)', acx_old)) = 'PT429');

  -- Finishing answers the passage requests from before the reservation
  -- started. One from after keeps the post requested.
  perform pg_temp.as_key(devbox_key);
  insert into everything_note_requests (item_id, status, status_reason, selection, created_at) values
    (requested, 'enqueued', 'checking the selected passage', 'a reader asked about before the switch', now() - interval '2 hours'),
    (requested, 'enqueued', 'checking the selected passage', 'a later question', now() + interval '1 minute');
  x := notewriter_api_reserve(requested);
  r := r || jsonb_build_object('reserve_carries_asked_passages', jsonb_array_length(x -> 'post' -> 'asked_passages') = 2 and (x -> 'post' ->> 'requested')::boolean);
  y := notewriter_api_finish((x ->> 'reservation')::uuid, '{"notes": 0}');
  r := r || jsonb_build_object(
    'finish_answers_earlier_request', (y ->> 'answered')::int = 1
      and (select status = 'done' and status_reason = 'the selected passage needs no note' from everything_note_requests where selection = 'a reader asked about before the switch'),
    'later_request_keeps_it_requested', (select list_requested and requested_since = now() + interval '1 minute' and status = 'queued' from everything_items where id = requested),
    'finish_twice_409', pg_temp.sqlstate_of(format('select notewriter_api_finish(%L)', x ->> 'reservation')) = 'PT409');

  -- Failing hides the post from that notewriter only.
  x := notewriter_api_reserve(acx_old);
  perform notewriter_api_fail((x ->> 'reservation')::uuid, 'could not open the sources');
  r := r || jsonb_build_object(
    'failed_post_hidden_from_failer', not exists (select 1 from jsonb_array_elements(notewriter_api_posts(10, null, 5, 'team') -> 'posts') p where (p ->> 'id')::uuid = acx_old),
    'failure_listed_in_me', notewriter_api_me() -> 'last_failures' -> 0 ->> 'reason' = 'could not open the sources');
  perform pg_temp.as_key(hq_key);
  r := r || jsonb_build_object('failed_post_listed_to_others', exists (select 1 from jsonb_array_elements(notewriter_api_posts(10, null, 5, 'team') -> 'posts') p where (p ->> 'id')::uuid = acx_old));

  -- A deadline that passed: the note and the finish fail with 409, and the
  -- tidy-up ends the reservation as expired and lowers the count.
  update everything_reservations set deadline = now() - interval '1 second' where id = res_hq;
  r := r || jsonb_build_object(
    'note_after_deadline_409', pg_temp.sqlstate_of(format($q$select notewriter_api_add_note(%L, '{"passage": "which is a claim worth checking", "note": "n", "sources": [{"url": "https://s.example"}]}')$q$, res_hq)) = 'PT409',
    'finish_after_deadline_409', pg_temp.sqlstate_of(format('select notewriter_api_finish(%L)', res_hq)) = 'PT409');
  x := to_jsonb(notewriter_tidy_list());
  r := r || jsonb_build_object(
    'tidy_expires', (x ->> 'expired')::int = 1 and (select outcome = 'expired' from everything_reservations where id = res_hq),
    'expired_lowers_count', (select list_all_count = 2 from everything_items where id = acx_today));

  -- A post that turned 14 days old leaves the list at the next tidy-up.
  update everything_items set published_at = current_date - 15 where id = low_today;
  r := r || jsonb_build_object('old_post_closes', (select not list_open from everything_items where id = low_today));

  -- Claude's drafts are posted as the notewriter of the post's reservation.
  insert into everything_claude_drafts (id, item_id, passage, note, sources, status)
  values ('00000000-0000-0000-0000-0000000002f1', acx_old, 'Three days ago ACX said the drug halved deaths', 'It did not.', '[{"url": "https://s.example"}]', 'posting');
  x := to_jsonb(everything_claude_publish('00000000-0000-0000-0000-0000000002f1', 'ai', 'claude'));
  r := r || jsonb_build_object('publish_as_reservations_notewriter', (select notewriter_id = 'claude-devbox' from everything_notes where id = (x #>> '{}')::uuid));

  -- Switching off refuses the key and ends its reservations.
  perform notewriter_admin_switch('jackson-hurley', false, 'spam');
  perform pg_temp.as_key(out_key);
  r := r || jsonb_build_object(
    'switched_off_403', pg_temp.sqlstate_of('select notewriter_api_me()') = 'PT403',
    'switch_ends_reservations', (select count(*) = 0 from everything_reservations where notewriter_id = 'jackson-hurley' and ended_at is null));

  -- Who may call what.
  perform set_config('request.headers', '{}', true);
  set local role anon;
  r := r || jsonb_build_object(
    'anon_calls_v2', pg_temp.sqlstate_of('select notewriter_api_posts()') = 'PT401',
    'anon_cannot_call_v1', pg_temp.sqlstate_of('select notewriter_next_post(''pipeline'')') = '42501',
    'anon_cannot_call_admin', pg_temp.sqlstate_of('select notewriter_admin_new_key(''pipeline'')') = '42501',
    'anon_cannot_read_reservations', pg_temp.sqlstate_of('select * from everything_reservations') = '42501');
  reset role;

  -- The health numbers for the dashboard.
  perform set_config('test.admin', 'true', true);
  r := r || jsonb_build_object('overview_lists_all', (select count(*) = 5 from everything_notewriters_overview()),
                               'overview_counts_failure', (select failed_7d = 1 from everything_notewriters_overview() where id = 'claude-devbox'));

  raise exception 'RESULTS %', r;
end;
$$;
