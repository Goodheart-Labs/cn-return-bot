-- Checks for migration 163, run after it against 163_x_note_twins.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Each result
-- should be true, and a null counts as a failure.
do $$
declare
  r jsonb := '{}';
  jim constant uuid := '00000000-0000-0000-0000-00000000000a';
  reader constant uuid := '00000000-0000-0000-0000-00000000000c';
  twin uuid;
  page text[];
  card x_note_card;
  allowed boolean;
begin
  r := r || jsonb_build_object(
    'backfill_twins_submitted_notes', (select array_agg(x_note_id order by x_note_id) = '{n1,n2,n3,n4}' from everything_notes where x_note_id is not null),
    'twin_written_when_submitted', (select created_at = '2026-10-20 10:00Z' and note = 'Note one https://a.example' from everything_notes where x_note_id = 'n1'));

  -- A note that gets submitted later gets its twin then, and a new submitted
  -- note gets one at once.
  update notes set submitted_at = '2026-10-29 10:00Z' where note_id = 'n5';
  insert into notes values ('n6', 't6', 'Note six', 'NEEDS_MORE_RATINGS', 0, '2026-10-30 10:00Z');
  r := r || jsonb_build_object('trigger_makes_twins', (select count(*) = 2 from everything_notes where x_note_id in ('n5', 'n6')));

  begin
    insert into everything_notes (note) values ('Neither a claim nor an X note');
    allowed := true;
  exception when check_violation then allowed := false;
  end;
  r := r || jsonb_build_object('note_needs_claim_or_x_note', not allowed);

  select id into twin from everything_notes where x_note_id = 'n1';
  insert into everything_votes (note_id, voter_id, vote) values (twin, jim, 1), (twin, reader, -1);

  -- A reader sees their own vote and not Jim's.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', reader)::text, true);
  set local role authenticated;
  select * into card from x_notewriter_page('{"filters": [{"column": "my_vote", "in": ["not_helpful"]}], "sorts": []}') c;
  r := r || jsonb_build_object('reader_sees_own_vote', card.note_id = 'n1' and card.twin_note_id = twin,
                               'reader_does_not_see_jim', card.fields -> 'jim_vote' = 'null'::jsonb);
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [{"column": "jim_vote", "in": ["helpful"]}], "sorts": []}') c;
  r := r || jsonb_build_object('reader_cannot_filter_by_jim', page is null);
  reset role;

  -- Jim sees his own vote and Jim's column.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', jim)::text, true);
  set local role authenticated;
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [{"column": "jim_vote", "in": ["helpful"]}], "sorts": []}') c;
  r := r || jsonb_build_object('admin_filters_by_jim', page = '{n1}');
  select array_agg(c.note_id order by c.note_id) into page from x_notewriter_page('{"filters": [{"column": "my_vote", "in": ["none"]}], "sorts": []}') c;
  r := r || jsonb_build_object('not_voted_yet', page = '{n2,n3,n4,n5,n6}');
  reset role;

  -- Common Notes' own notes leave the twins out.
  set local role anon;
  r := r || jsonb_build_object('commonnotes_summary_skips_twins', (
    select s.notes = (select count(*) from everything_notes where status <> 'hidden' and claim_id is not null)
      from notewriter_summary('commonnotes', '{"filters": []}') s));
  reset role;

  raise exception 'results: %', r;
end;
$$;
