-- Checks for migration 145, run after it against 145_no_approval_step.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Every value in
-- the result should be true, and `let_through` should be an empty list.
do $$
declare
  jim uuid := '00000000-0000-0000-0000-00000000000a';
  nathan uuid := '00000000-0000-0000-0000-00000000000b';
  reader uuid := '00000000-0000-0000-0000-00000000000c';
  rejected uuid := '00000000-0000-0000-0000-0000000000d1';
  approved uuid := '00000000-0000-0000-0000-0000000000d2';
  downvoted uuid := '00000000-0000-0000-0000-0000000000d3';
  open uuid := '00000000-0000-0000-0000-0000000000d4';
  waiting uuid := '00000000-0000-0000-0000-0000000000d5';
  open_note uuid;
  stmt text;
  let_through text[] := '{}';
  s record;
  r jsonb := '{}';
begin
  select note_id into open_note from everything_claude_drafts where id = open;

  foreach stmt in array array[
    'select * from everything_claude_review_summary()',
    format('select everything_claude_delete_note(%L)', waiting)
  ] loop
    for s in select * from (values ('anon', null::uuid), ('authenticated', reader)) v(role, sub) loop
      perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role', s.role, 'sub', s.sub))::text, true);
      execute format('set local role %I', s.role);
      begin
        execute stmt;
        let_through := let_through || (coalesce(s.sub::text, 'anon') || ': ' || stmt);
      exception when others then
        null;
      end;
      reset role;
    end loop;
  end loop;

  -- Nathan votes Helpful on the open note and explains it.
  insert into everything_votes (note_id, voter_id, vote) values (open_note, nathan, 1);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', nathan)::text, true);
  set local role authenticated;
  perform everything_claude_explain(open, 'Real error');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  select * into s from everything_claude_review_summary();
  r := r || jsonb_build_object('unposted_counts_as_not_reviewed', s.unreviewed = 2 and s.approved = 2 and s.disapproved = 2);
  select * into s from everything_claude_review_summary(p_reviewed_by => 'nathan');
  r := r || jsonb_build_object('reviewed_by_nathan', s.approved = 2 and s.disapproved = 0 and s.unreviewed = 0);
  select * into s from everything_claude_review_summary(p_reviewed_by => 'jim');
  r := r || jsonb_build_object('reviewed_by_jim', s.approved = 0 and s.disapproved = 2);
  r := r || jsonb_build_object(
    'page_filters_by_reviewer', (select array_agg(id order by id) = array[approved, open] from everything_claude_review_page('approved', p_reviewed_by => 'nathan')),
    'page_lists_unposted_drafts', (select count(*) = 2 from everything_claude_review_page('unreviewed')),
    'row_carries_reviewer_votes', (select reviewer_votes = '[{"reviewer": "nathan", "vote": 1}]'::jsonb from everything_claude_review_drafts(array[open])),
    'explanation_carries_its_vote', (select explanations -> 0 ->> 'vote' = '1' and explanations -> 0 ->> 'actor' = 'nathan' from everything_claude_review_drafts(array[open])),
    'old_rejection_is_marked', (select explanations -> 0 ->> 'vote' = 'rejected' from everything_claude_review_drafts(array[rejected])),
    'downvote_row', (select reviewer_votes -> 0 ->> 'reviewer' = 'jim' from everything_claude_review_drafts(array[downvoted]))
  );
  perform everything_claude_delete_note(waiting);
  reset role;
  r := r || jsonb_build_object(
    'unposted_draft_can_be_deleted', (select status = 'removed' and verdict = 'disapproved' from everything_claude_drafts where id = waiting)
  );

  r := r || jsonb_build_object('let_through', to_jsonb(let_through));
  raise exception 'RESULT %', r;
end $$;
