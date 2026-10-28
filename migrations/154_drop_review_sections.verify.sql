-- Checks for migration 154, run after it against 154_drop_review_sections.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  d2_note uuid := (select note_id from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d2');
  r jsonb := '{}';
begin
  r := r || jsonb_build_object(
    'late_posted_mark_kept', exists (select 1 from everything_note_x_marks where note_id = d2_note and mark = 'posted'),
    'posted_at_column_gone', not exists (select 1 from information_schema.columns where table_name = 'everything_best_notes' and column_name = 'posted_at'),
    'old_functions_gone', to_regprocedure('everything_claude_review_drafts(uuid[])') is null
                          and to_regprocedure('everything_claude_crowd_rating(uuid)') is null
                          and to_regtype('everything_claude_review_draft') is null,
    'new_functions_stay', to_regprocedure('everything_review_drafts(uuid[])') is not null
  );
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('leaderboard_reads_the_mark', (select bool_and(posted_at is not null) from everything_curation_page('leaderboard')));
  perform everything_set_x_mark(d2_note, null);
  r := r || jsonb_build_object('unmarked', (select posted_at is null from everything_curation_page('leaderboard') where note_id = d2_note));
  reset role;
  raise exception 'results: %', r;
end;
$$;
