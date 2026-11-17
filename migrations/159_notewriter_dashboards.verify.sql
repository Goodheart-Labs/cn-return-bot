-- Checks for migration 159, run after it against 159_notewriter_dashboards.fixture.sql
-- (the commands are at the top of the fixture). The block ends by raising an
-- error that carries every result, so nothing it wrote stays. Each result
-- should be true, and a null counts as a failure.
do $$
declare
  r jsonb := '{}';
  page text[];
  rest text[];
  last_key float8[];
  last_id text;
  card x_note_card;
  ab jsonb;
  allowed boolean;
begin
  -- The X run writes the live tests. "old" is only in old runs.
  perform x_sync_ab_tests('[
    {"test": "bot", "fill_variant": "a", "control_variant": "a", "variants": ["a", "b", "c"]},
    {"test": "search", "fill_variant": "s1", "control_variant": "s1", "variants": ["s1", "s2"]}
  ]');
  r := r || jsonb_build_object(
    'tests_in_code_order', (select array_agg(test order by position nulls last, test) = '{bot,search,old}' from x_ab_tests),
    'retired_test_kept', (select position is null and variants = '{x}' from x_ab_tests where test = 'old')
  );

  set local role anon;

  -- Newest first by default, paged.
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [], "sorts": []}', null, null, 2) c;
  select c.sort_key, c.note_id into last_key, last_id
    from x_notewriter_page('{"filters": [], "sorts": []}', null, null, 2) c offset 1;
  select array_agg(c.note_id) into rest from x_notewriter_page('{"filters": [], "sorts": []}', last_key, last_id, 2) c;
  r := r || jsonb_build_object('newest_first_paged', page = '{n4,n3}' and rest = '{n2,n1}');

  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [{"column": "picks.bot", "in": ["a"]}], "sorts": []}') c;
  r := r || jsonb_build_object('filter_by_arm', page = '{n2,n1}');
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [{"column": "picks.search", "in": ["s1"]}], "sorts": []}') c;
  r := r || jsonb_build_object('filter_fills_default_arm', page = '{n3,n1}');
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [], "sorts": [{"column": "views", "descending": true}]}') c;
  r := r || jsonb_build_object('sort_by_views', page[1:2] = '{n1,n2}');
  select array_agg(c.note_id) into page from x_notewriter_page('{"filters": [{"column": "status", "in": ["helpful", "not_helpful"]}], "sorts": []}') c;
  r := r || jsonb_build_object('filter_by_status', page = '{n2,n1}');

  select * into card from x_notewriter_page('{"filters": [{"column": "status", "in": ["helpful"]}], "sorts": []}') c;
  r := r || jsonb_build_object('card', card.author_handle = 'alice' and card.referenced_kind = 'quoted' and card.helpful_ratings = 5
                                       and (card.fields ->> 'ratings')::int = 7 and card.fields -> 'picks' ->> 'bot' = 'a');

  r := r || jsonb_build_object('facets', (
    select jsonb_object_agg(f.value, f.notes) = '{"a": 2, "b": 1}'
      from notewriter_facets('x', '{"filters": [{"column": "picks.bot", "in": ["b"]}]}', '[{"column": "picks.bot"}]') f));
  r := r || jsonb_build_object('summary', (
    select s.notes = 4 and s.helpful = 1 and s.views = 110 from notewriter_summary('x', '{"filters": []}') s));
  r := r || jsonb_build_object('days_with_runs', (
    select d.helpful = 0 and d.not_helpful = 1 and d.runs = 2 and d.submitted_runs = 1
      from notewriter_days('x', '{"filters": []}', true) d where d.day = '2026-10-21'));
  r := r || jsonb_build_object('days_runs_take_arm_filters', (
    select sum(d.runs) = 3 and sum(d.helpful + d.not_helpful + d.needs_ratings) = 2
      from notewriter_days('x', '{"filters": [{"column": "picks.bot", "in": ["a"]}]}', true) d));
  r := r || jsonb_build_object('days_without_runs', (
    select sum(d.runs) = 0 from notewriter_days('x', '{"filters": []}', false) d));
  r := r || jsonb_build_object('tests', (
    select jsonb_agg(jsonb_build_array(t.test, t.live, t.recently_varied) order by t.test) = '[["bot", true, true], ["old", false, false], ["search", true, false]]'
      from notewriter_tests('x') t));
  r := r || jsonb_build_object('reasons', (
    select jsonb_object_agg(x.reason, x.uses) = '{"hallucination": 1, "helpfulGoodSources": 3, "notHelpfulIncorrect": 1}'
      from notewriter_reasons('x') x));
  r := r || jsonb_build_object('origin_days', (select count(*) = 1 from x_notewriter_origin_days()));

  select jsonb_object_agg(c.picks ->> 'bot', jsonb_build_array(c.helpful, c.not_helpful, c.needs_ratings, c.runs, c.candidate_runs, c.cost, c.reviewed, c.failure_modes, c.helpful_ratings))
    into ab from notewriter_ab_compare('x', '{bot}') c;
  r := r || jsonb_build_object('ab_compare', ab = '{"a": [1, 1, 0, 3, 2, 0.875, 1, {"hallucination": 1}, 5], "b": [0, 0, 1, 1, 1, 0.25, 0, {}, 0]}'::jsonb);
  select jsonb_object_agg(c.picks::text, c.runs) into ab from notewriter_ab_compare('x', '{bot,search}', '2026-10-21') c;
  r := r || jsonb_build_object('ab_compare_two_tests_since', ab = '{"{\"bot\": \"a\", \"search\": \"s1\"}": 1, "{\"bot\": \"a\", \"search\": \"s2\"}": 1, "{\"bot\": \"b\", \"search\": \"s1\"}": 1}'::jsonb);

  -- Common Notes offers only the tests its own checks varied.
  r := r || jsonb_build_object('commonnotes_tests', (
    select array_agg(t.test) = '{search}' from notewriter_tests('commonnotes') t));
  r := r || jsonb_build_object('commonnotes_summary', (
    select s.notes = (select count(*) from everything_notes where status <> 'hidden') from notewriter_summary('commonnotes', '{"filters": []}') s));
  r := r || jsonb_build_object('commonnotes_compare', (
    select jsonb_object_agg(c.picks ->> 'search', jsonb_build_array(c.runs, c.candidate_runs, c.helpful + c.not_helpful + c.needs_ratings))
             = '{"s1": [1, 0, 0], "s2": [1, 1, 1]}'::jsonb
      from notewriter_ab_compare('commonnotes', '{search}') c));
  r := r || jsonb_build_object('commonnotes_picks_of_pipeline_notes', (
    select jsonb_object_agg(f.value, f.notes) = '{"s2": 1}'
      from notewriter_facets('commonnotes', '{"filters": []}', '[{"column": "picks.search"}]') f));
  begin
    perform * from notewriter_summary('bluesky', '{"filters": []}');
    allowed := true;
  exception when others then allowed := false;
  end;
  r := r || jsonb_build_object('unknown_source_refused', not allowed);

  begin
    perform x_sync_ab_tests('[]');
    allowed := true;
  exception when insufficient_privilege then allowed := false;
  end;
  r := r || jsonb_build_object('anon_cannot_sync_tests', not allowed);
  begin
    perform * from x_notewriter_page('{"filters": [{"column": "note_text", "in": ["x"]}], "sorts": []}');
    allowed := true;
  exception when others then allowed := false;
  end;
  r := r || jsonb_build_object('unknown_field_refused', not allowed);

  raise exception 'results: %', r;
end;
$$;
