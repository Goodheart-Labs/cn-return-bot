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

-- Drift check: every note's stored feed values equal what its votes, claim
-- and post give today. A write path the triggers miss shows up here.
do $$
declare drifted int;
begin
  select count(*) into drifted
    from everything_notes n, everything_note_feed_fields(n) f
   where (n.p_helpful, n.p_helpful_after_helpful, n.feed_item_id, n.feed_project_id, n.feed_band, n.feed_votes,
          n.feed_helpful_key, n.feed_needs_key, n.feed_best_key, n.feed_recent_key, n.feed_content_key)
         is distinct from
         (f.p_helpful, f.p_helpful_after_helpful, f.feed_item_id, f.feed_project_id, f.feed_band, f.feed_votes,
          f.feed_helpful_key, f.feed_needs_key, f.feed_best_key, f.feed_recent_key, f.feed_content_key);
  if drifted > 0 then raise exception '% notes have feed values that differ from their votes, claim and post', drifted; end if;
end $$;

-- Each write path moves the stored values: a vote, an edited source text, a
-- new publication date and a new project, and a new improvement, which joins
-- the chain of the note it improves. The rows are rolled back at the end.
begin;
insert into everything_projects (id, slug, name) values
  ('00000000-0000-0000-0000-00000000e001', 'verify-139-a', 'Verify 139 A'),
  ('00000000-0000-0000-0000-00000000e002', 'verify-139-b', 'Verify 139 B');
insert into everything_items (id, project_id, url, source, published_at) values
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000e001', 'https://example.com/verify-139-triggers', 'web', '2026-10-01');
insert into everything_claims (id, item_id, claim, judgement) values
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-00000000e003', 'claim', 'uncertain');
insert into everything_notes (id, claim_id, note, created_at) values
  ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-00000000e004', 'original', '2026-10-02');
do $$
declare
  original constant uuid := '00000000-0000-0000-0000-00000000e005';
  n everything_notes;
begin
  select * into n from everything_notes where id = original;
  if n.feed_band <> 'needs_ratings' or n.feed_project_id <> '00000000-0000-0000-0000-00000000e001' then
    raise exception 'a new note got band % and project %', n.feed_band, n.feed_project_id;
  end if;

  update everything_notes set helpful_count = 3 where id = original;
  select * into n from everything_notes where id = original;
  if n.feed_band <> 'helpful' or n.feed_votes <> 3 then raise exception 'three Helpful votes left band % and % votes', n.feed_band, n.feed_votes; end if;

  update everything_claims set updated_quote = 'the source changed' where id = '00000000-0000-0000-0000-00000000e004';
  select * into n from everything_notes where id = original;
  if n.feed_band <> 'stale' then raise exception 'an edited source left band %', n.feed_band; end if;

  update everything_items set published_at = '2026-10-10', project_id = '00000000-0000-0000-0000-00000000e002'
   where id = '00000000-0000-0000-0000-00000000e003';
  select * into n from everything_notes where id = original;
  if n.feed_best_key[2] <> -extract(epoch from '2026-10-10 00:00:00+00'::timestamptz) or n.feed_project_id <> '00000000-0000-0000-0000-00000000e002' then
    raise exception 'a new publication date and project left % and %', n.feed_best_key, n.feed_project_id;
  end if;

  insert into everything_notes (id, claim_id, note, improved_from_note_id, created_at)
  values ('00000000-0000-0000-0000-00000000e006', '00000000-0000-0000-0000-00000000e004', 'improvement', original, '2026-10-05');
  if (select feed_content_key[2] from everything_notes where id = '00000000-0000-0000-0000-00000000e006') <> extract(epoch from '2026-10-02 00:00:00+00'::timestamptz) then
    raise exception 'an improvement did not join the chain of the note it improves';
  end if;
end $$;
rollback;

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

-- The mixed order on a small project of its own, three notes per page, so
-- every bookmark is crossed. The rows are rolled back at the end. The three
-- most helpful notes lead, then a note that needs ratings alternates with one
-- more helpful note, the oldest such note first. Unhelpful notes follow, and a
-- note whose source text changed comes last, however helpful it is. The
-- Newest and Most helpful orders have no bands.
reset role;
begin;
insert into everything_projects (id, slug, name) values ('00000000-0000-0000-0000-00000000f001', 'verify-139', 'Verify 139');
insert into everything_items (id, project_id, url, source) values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f001', 'https://example.com/verify-139', 'web');
insert into everything_claims (id, item_id, claim, judgement, updated_quote)
select ('00000000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid, '00000000-0000-0000-0000-00000000f002', 'claim ' || n, 'uncertain',
       case when n = 9 then 'the source changed' end
  from generate_series(1, 9) n;
insert into everything_notes (id, claim_id, note, helpful_count, somewhat_helpful_count, not_helpful_count, created_at)
select ('00000000-0000-0000-0000-0000001' || lpad(n::text, 5, '0'))::uuid, ('00000000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid,
       name, h, s, nh, '2026-10-01'::timestamptz + n * interval '1 hour'
  from (values (1, 'helpful-6', 6, 0, 0), (2, 'helpful-5', 5, 0, 0), (3, 'helpful-4', 4, 0, 0), (4, 'helpful-3', 3, 0, 0),
               (5, 'unrated-older', 0, 0, 0), (6, 'unrated-newer', 0, 0, 0), (7, 'unhelpful', 0, 0, 3),
               (8, 'one-somewhat', 0, 1, 0), (9, 'stale-but-helpful', 9, 0, 0)) v(n, name, h, s, nh);
do $$
declare
  ordering text;
  after jsonb;
  page jsonb;
  got text[];
  expected text[];
begin
  foreach ordering in array array['mixed', 'helpful'] loop
    after := null;
    got := '{}';
    loop
      page := everything_note_feed_page(p_project_id => '00000000-0000-0000-0000-00000000f001', p_order => ordering, p_after => after, p_limit => 3);
      got := got || array(select n.note || ':' || (p.entry ->> 'band')
                            from jsonb_array_elements(page -> 'notes') with ordinality p(entry, place)
                            join everything_notes n on n.id = (p.entry ->> 'id')::uuid
                           order by p.place);
      after := page -> 'next';
      exit when after = 'null'::jsonb;
    end loop;
    expected := case ordering
      when 'mixed' then array['helpful-6:main', 'helpful-5:main', 'helpful-4:main', 'one-somewhat:main', 'helpful-3:main',
                              'unrated-older:main', 'unrated-newer:main', 'unhelpful:unhelpful', 'stale-but-helpful:stale']
      else array['stale-but-helpful:all', 'helpful-6:all', 'helpful-5:all', 'helpful-4:all', 'helpful-3:all',
                  'one-somewhat:all', 'unrated-older:all', 'unrated-newer:all', 'unhelpful:all'] end;
    if got is distinct from expected then raise exception '% order: got %, expected %', ordering, got, expected; end if;
  end loop;
end $$;
rollback;
set role anon;

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
