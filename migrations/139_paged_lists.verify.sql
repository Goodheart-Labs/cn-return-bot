-- Checks migration 139 (GOO-524). It runs on any copy of the tables, with or
-- without rows. It was run on a copy of production's notes on 2026-10-23,
-- where a separate script also compared every order, page by page, with the
-- browser's ranking that this migration replaces, and found them equal.

-- The chance of ending up helpful matches probabilityHelpful in
-- src/everything-core/noteBelief.ts, whose values these are.
do $$
declare bad text;
begin
  select string_agg(format('(%s, %s, %s): %s instead of %s', h, s, n, everything_probability_helpful(h, s, n), expected), '; ')
    into bad
    from (values (0, 0, 0, 0.34999999999999876), (1, 0, 0, 0.5766834604233255), (2, 0, 0, 0.7458065970600121),
                 (2, 1, 0, 0.8075235096826988), (0, 1, 0, 0.4691264353303495), (0, 0, 1, 0.23522160669894765),
                 (0, 0, 2, 0.1555016321053636), (5, 2, 3, 0.8683235246094801), (40, 10, 7, 0.9999999999672158),
                 (0, 0, 30, 2.7352515630241214e-7), (200, 0, 0, 1)) v(h, s, n, expected)
   where abs(everything_probability_helpful(h, s, n) - expected) > 1e-12;
  if bad is not null then raise exception 'probability differs from TypeScript: %', bad; end if;
end $$;

-- The thresholds of noteScore.ts: 2 Helpful votes are not enough on their
-- own, 2 Helpful and 1 Somewhat are. One Not helpful vote is not enough to
-- rate a note unhelpful, two are.
do $$
begin
  if everything_note_status(everything_probability_helpful(2, 0, 0)) <> 'needs_ratings'
     or everything_note_status(everything_probability_helpful(2, 1, 0)) <> 'helpful'
     or everything_note_status(everything_probability_helpful(0, 0, 1)) <> 'needs_ratings'
     or everything_note_status(everything_probability_helpful(0, 0, 2)) <> 'not_helpful' then
    raise exception 'note status thresholds differ from noteScore.ts';
  end if;
end $$;

-- Paging through each order, a few notes at a time, gives every visible note
-- exactly once, and stops.
set role anon;
do $$
declare
  visible int;
  ordering text;
  after jsonb;
  page jsonb;
  ids uuid[];
  pages int;
begin
  select count(*) into visible from everything_notes where status <> 'hidden';
  foreach ordering in array array['mixed', 'recent', 'helpful'] loop
    after := null;
    ids := '{}';
    pages := 0;
    loop
      page := everything_note_feed_page(p_order => ordering, p_after => after, p_limit => 7);
      ids := ids || array(select (n ->> 'id')::uuid from jsonb_array_elements(page -> 'notes') n);
      pages := pages + 1;
      after := page -> 'next';
      exit when after = 'null'::jsonb or pages > visible + 1;
    end loop;
    if cardinality(ids) <> visible or (select count(distinct x) from unnest(ids) x) <> visible then
      raise exception '% order paged % notes (% different) out of %', ordering, cardinality(ids), (select count(distinct x) from unnest(ids) x), visible;
    end if;
  end loop;
end $$;

-- The summary counts the same notes the pages show.
do $$
declare summary jsonb := everything_note_feed_summary();
begin
  if (summary ->> 'matching')::int <> (select count(*) from everything_notes where status <> 'hidden') then
    raise exception 'summary counts % notes', summary ->> 'matching';
  end if;
end $$;

-- The creators overview and a creator's posts answer the website's key.
select count(*) from everything_projects_page('votes');
select count(*) from everything_projects_page('name');
select count(*) from everything_project_items_page((select id from everything_projects limit 1));

-- The curation refuses anyone who is not an admin.
do $$
begin
  perform everything_curation_summary('recommendations');
  raise exception 'the curation summary answered the website''s key';
exception when insufficient_privilege then null;
end $$;
reset role;
