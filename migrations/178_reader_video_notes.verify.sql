-- Checks for migration 178. Run it after the migration, against a copy made by
-- scripts/schema_fixture.py (see migrations/README_114.md for the steps). The
-- block ends by raising an error that carries every result, so whatever it
-- created is always rolled back. Every value in the result should be true.
--
-- The inserts copy what everything-core sends: ensurePageItem (items.ts) and
-- postClaimWithNote (postNote.ts) with a text anchor and with a video anchor.
do $$
declare
  reader uuid := gen_random_uuid();
  v_project uuid;
  v_video uuid;
  v_page uuid;
  v_claim uuid;
  r jsonb := '{}';
  refused boolean;
begin
  insert into auth.users (id, email) values (reader, 'reader@example.com');
  insert into everything_projects (slug, name) values ('goo746-web', 'Around the web') returning id into v_project;

  -- A signed-in reader, as PostgREST sets it up.
  perform set_config('request.jwt.claims', json_build_object('sub', reader, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Items.
  insert into everything_items (project_id, source, url, title, status)
    values (v_project, 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'A video', 'done') returning id into v_video;
  r := r || jsonb_build_object('video_item_insert_works', v_video is not null);

  insert into everything_items (project_id, source, url, title, status)
    values (v_project, 'web', 'https://example.com/goo746', 'A page', 'done') returning id into v_page;
  r := r || jsonb_build_object('web_item_insert_still_works', v_page is not null);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'done');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('video_item_with_extra_parameters_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'youtube', 'https://example.com/watch?v=dQw4w9WgXcQ', 'done');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('video_item_off_youtube_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'youtube', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'queued');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('queued_video_item_refused', refused);

  refused := false;
  begin
    insert into everything_items (project_id, source, url, status) values (v_project, 'substack', 'https://a.substack.com/p/b', 'done');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('other_sources_refused', refused);

  -- 2. Claims with a time range, as postClaimWithNote sends a video anchor.
  insert into everything_claims (item_id, claim, judgement, context_quote, context_url, status, created_by, start_seconds, end_seconds)
    values (v_video, 'At 11:59 to 12:34 in the video', 'user', null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=719s', 'note', reader, 719, 754)
    returning id into v_claim;
  r := r || jsonb_build_object('video_claim_insert_works', v_claim is not null);

  insert into everything_claims (item_id, claim, judgement, context_quote, context_url, status, created_by, start_seconds, end_seconds)
    values (v_video, 'At 0:00 to 2:00 in the video', 'user', null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0s', 'note', reader, 0, 120)
    returning id into v_claim;
  r := r || jsonb_build_object('two_minute_range_works', v_claim is not null);

  insert into everything_claims (item_id, claim, judgement, context_quote, context_paragraph, context_url, status, created_by)
    values (v_page, 'quoted text', 'user', 'quoted text', 'the paragraph', 'https://example.com/goo746', 'note', reader)
    returning id into v_claim;
  r := r || jsonb_build_object('text_claim_still_works', v_claim is not null);

  refused := false;
  begin
    insert into everything_claims (item_id, claim, judgement, context_url, status, created_by, start_seconds, end_seconds)
      values (v_video, 'x', 'user', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'note', reader, 0, 121);
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('range_over_two_minutes_refused', refused);

  refused := false;
  begin
    insert into everything_claims (item_id, claim, judgement, context_url, status, created_by, start_seconds, end_seconds)
      values (v_video, 'x', 'user', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'note', reader, 30, 30);
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('empty_range_refused', refused);

  refused := false;
  begin
    insert into everything_claims (item_id, claim, judgement, context_url, status, created_by, start_seconds, end_seconds)
      values (v_video, 'x', 'user', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'note', reader, -5, 5);
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('negative_start_refused', refused);

  refused := false;
  begin
    insert into everything_claims (item_id, claim, judgement, context_url, status, created_by, start_seconds)
      values (v_video, 'x', 'user', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'note', reader, 30);
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('start_without_end_refused', refused);

  -- 3. The pipeline keeps its freedom: a claim without an end, or a long one.
  reset role;
  insert into everything_claims (item_id, claim, judgement, context_quote, status, start_seconds)
    values (v_video, 'pipeline claim', 'uncertain', 'words', 'note', 600) returning id into v_claim;
  r := r || jsonb_build_object('pipeline_claim_without_end_works', v_claim is not null);
  insert into everything_claims (item_id, claim, judgement, context_quote, status, start_seconds, end_seconds)
    values (v_video, 'pipeline claim', 'uncertain', 'words', 'note', 0, 900) returning id into v_claim;
  r := r || jsonb_build_object('long_pipeline_claim_works', v_claim is not null);

  raise exception 'RESULT %', r;
end $$;
