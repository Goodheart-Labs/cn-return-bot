-- Checks for migration 154, run after it against 154_x_accounts_and_clicks.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  d4_note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4');
  r jsonb := '{}';
  let_through text[] := '{}';
  counts jsonb;
begin
  r := r || jsonb_build_object('nathans_handle_seeded', (select x_handle = 'TheZvi' and x_handle_status = 'found' from everything_projects where slug = 'thezvi'));

  -- Clicks: a reader opens d4's note link twice on one device and once on
  -- another, clicks two buttons and a store; Jim's own visit does not count.
  insert into everything_events (event, platform, device_id, user_id, props) values
    ('pageview', 'web', 'a', reader, jsonb_build_object('url', 'https://commonnotes.net/notes/some-creator?note=' || d4_note)),
    ('pageview', 'web', 'a', null, jsonb_build_object('url', 'https://commonnotes.net/notes/some-creator?note=' || d4_note)),
    ('pageview', 'web', 'b', null, jsonb_build_object('url', 'https://commonnotes.net/notes/some-creator?note=' || d4_note || '&x=1')),
    ('pageview', 'web', 'j', jim, jsonb_build_object('url', 'https://commonnotes.net/notes/some-creator?note=' || d4_note)),
    ('pageview', 'web', 'a', null, '{"url": "https://commonnotes.net/notes/all"}'),
    ('get_extension_clicked', 'web', 'a', null, '{"button": "header"}'),
    ('get_extension_clicked', 'web', 'b', null, '{"button": "header"}'),
    ('extension_store_clicked', 'web', 'a', null, '{"browser": "Chrome"}');

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  begin
    perform everything_set_x_handle('some-creator', 'someone', 'guess');
    let_through := let_through || 'a reader set a handle'::text;
  exception when others then null;
  end;
  begin
    perform everything_click_counts(now() - interval '1 day');
    let_through := let_through || 'a reader read the click counts'::text;
  exception when others then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_set_x_handle('some-creator', '@SomeCreator', 'Their site links to it.');
  perform everything_set_x_handle('other-creator', null, 'No X account anywhere.');
  begin
    perform everything_set_x_handle('thezvi', 'not a handle!', 'x');
    let_through := let_through || 'an invalid handle'::text;
  exception when others then null;
  end;
  r := r || jsonb_build_object(
    'found_in_fields', (select fields @> '{"creator_x": "found", "creator_x_handle": "SomeCreator", "creator_x_evidence": "Their site links to it."}' from everything_review_drafts(array['00000000-0000-0000-0000-0000000000d4'::uuid])),
    'none_in_fields', (select fields @> '{"creator_x": "none"}' and fields -> 'creator_x_handle' = 'null' from everything_review_drafts(array['00000000-0000-0000-0000-0000000000d7'::uuid]))
  );
  counts := everything_click_counts(now() - interval '1 day');
  reset role;
  r := r || jsonb_build_object(
    'checked_by_jim', (select x_handle_checked_by = 'jim' and x_handle_evidence = 'Their site links to it.' from everything_projects where slug = 'some-creator'),
    'note_opens', counts -> 'note_opens' = '3' and counts -> 'notes' -> 0 ->> 'opens' = '3' and counts -> 'notes' -> 0 ->> 'devices' = '2',
    'buttons', counts -> 'get_extension' = '[{"button": "header", "clicks": 2, "devices": 2}]',
    'stores', counts -> 'stores' = '[{"browser": "Chrome", "clicks": 1, "devices": 1}]'
  );
  raise exception 'results: % let through: %', r, let_through;
end;
$$;
