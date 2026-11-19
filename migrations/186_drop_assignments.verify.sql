-- Checks for migration 186, run after it (the commands are at the top of
-- 186_drop_assignments.fixture.sql). The block ends by raising an error that
-- carries every result, so nothing it wrote stays.
do $$
declare
  r jsonb := '{}';
  site uuid := '00000000-0000-0000-0000-0000000004b1';
  article uuid := '00000000-0000-0000-0000-0000000004a1';
begin
  r := r || jsonb_build_object(
    'tiers_gone', not exists (select 1 from information_schema.columns where table_name = 'everything_items' and column_name in ('priority', 'queued_at')),
    'breaks_gone', not exists (select 1 from information_schema.columns where table_name = 'everything_notewriters' and column_name in ('cooldown_until', 'failures_in_a_row')),
    'assignments_gone', to_regclass('everything_assignments') is null and to_regclass('everything_top_posts') is null,
    'reservations_stay', (select count(*) >= 1 from everything_reservations));

  -- The functions that read the tiers still run.
  perform * from everything_feed_pacing(48, 5, 168, now() - interval '30 days');
  perform * from everything_creator_ranking(10, 1, 2, 2, 3);

  -- A post a reader asked for is still requested, and finishing it ends the request.
  insert into everything_items (id, url, full_text, published_at, status, requested_since) values
    (article, 'https://article.example', 'An article an admin wants fact-checked in full.', current_date, 'done', null);
  insert into everything_minisites (id, item_id) values (site, article);
  update everything_items set status = 'error' where id = article;
  perform everything_start_minisite_check(site);
  r := r || jsonb_build_object('minisite_check_requests', (select list_requested and list_open and status = 'queued' from everything_items where id = article));
  update everything_items set status = 'done' where id = article;
  r := r || jsonb_build_object('done_ends_request', (select not list_requested and requested_since is null from everything_items where id = article));

  -- v1 and v2 still work.
  r := r || jsonb_build_object('v1_still_answers', notewriter_next_post('claude-ai-box') ->> 'kind' in ('post', 'wait'),
                               'status_still_answers', notewriter_status('claude-ai-box') ? 'open');

  raise exception 'RESULTS %', r;
end;
$$;
