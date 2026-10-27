-- Checks for migration 146, run after it against 146_review_summary_decided_by.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  s record;
  r jsonb := '{}';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  select * into s from everything_claude_review_summary(p_reviewed_by => 'nathan');
  r := r || jsonb_build_object('decided_by_narrows_only_decided_sections', s.approved = 1 and s.disapproved = 0 and s.unreviewed = 3);
  select * into s from everything_claude_review_summary(p_reviewed_by => 'jim');
  r := r || jsonb_build_object('jim', s.approved = 0 and s.disapproved = 2 and s.unreviewed = 3);
  reset role;
  raise exception 'RESULT %', r;
end $$;
