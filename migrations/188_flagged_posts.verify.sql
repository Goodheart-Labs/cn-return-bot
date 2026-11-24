-- Checks for migration 188, run after it on migration 184's fixture (the
-- commands are at the top of 184_notewriter_api.fixture.sql, then 185 and 186
-- as 186's fixture says). The block ends by raising an error that carries
-- every result, so nothing it wrote stays. Each result should be true.

create or replace function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;

do $$
declare
  r jsonb := '{}';
  requested uuid := '00000000-0000-0000-0000-000000000003';
  failed int;
begin
  r := r || jsonb_build_object('listed_before', (select list_open and list_requested from everything_items where id = requested));

  failed := everything_flag_item(requested, 'sexual score 0.83');
  r := r || jsonb_build_object(
    'open_request_failed', failed = 1,
    'request_says_why', (select bool_and(status = 'error' and status_reason = everything_flagged_request_reason())
                           from everything_note_requests where item_id = requested),
    'post_done_and_skipped', (select status = 'done' and skip_reason = 'image flagged' and flagged_at is not null
                                from everything_items where id = requested),
    'post_unlisted', (select not list_open and not list_requested and requested_since is null from everything_items where id = requested),
    'reserve_refused', pg_temp.sqlstate_of(format(
      'select everything_reserve((select w from everything_notewriters w where id = %L), %L::uuid, 5)', 'pipeline', requested)) = 'PT403',
    'flag_unknown_post_refused', pg_temp.sqlstate_of('select everything_flag_item(gen_random_uuid(), ''x'')') = 'PT404');

  -- A reader asks again later: the request fails at once, and the post stays unlisted.
  insert into everything_note_requests (item_id, status, status_reason) values (requested, 'enqueued', 'checking the selected passage');
  update everything_items set requested_since = now() where id = requested;
  r := r || jsonb_build_object(
    'later_request_failed', (select count(*) = 0 from everything_note_requests where item_id = requested and status <> 'error'),
    'still_unlisted', (select not list_open and requested_since is null from everything_items where id = requested));

  raise exception 'RESULTS %', r;
end;
$$;
