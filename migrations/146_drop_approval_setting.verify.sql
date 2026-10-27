-- Checks for migration 146, run after it against 146_drop_approval_setting.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Not reviewed
-- holds the two posting drafts and the open note nobody voted on.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  s record;
  r jsonb := '{}';
  let_through text[] := '{}';
begin
  r := r || jsonb_build_object(
    'waiting_became_posting', (select count(*) = 2 from everything_claude_drafts where status = 'posting'),
    'setting_is_gone', not exists (select 1 from information_schema.columns where table_name = 'everything_claude_settings' and column_name = 'approval_required')
  );
  begin
    insert into everything_claude_drafts (item_id, passage, claim, kind, outcome, reasoning, status)
    values ('00000000-0000-0000-0000-0000000000e1', 'p', 'c', 'small_mistake', 'note', 'r', 'awaiting_approval');
    let_through := let_through || 'awaiting_approval is still accepted'::text;
  exception when others then
    null;
  end;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  begin
    perform everything_claude_change_settings('pipeline');
    let_through := let_through || 'a reader changed the settings'::text;
  exception when others then
    null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  perform everything_claude_change_settings('pipeline');
  select * into s from everything_claude_review_summary();
  reset role;
  r := r || jsonb_build_object(
    'settings_change', (select writer = 'pipeline' and updated_by = 'jim' from everything_claude_settings),
    'posting_counts_as_not_reviewed', s.unreviewed = 3
  );
  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
