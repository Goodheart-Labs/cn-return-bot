-- GOO-697: the A/B tests page now has three cost metrics instead of one: the
-- cost per helpful note, per submitted note and per pipeline run. The cost per
-- run needs its own confidence interval. That interval depends on how much the
-- cost varies from one run to the next, so the comparison now also returns the
-- sum of the squares of the run costs. The function is otherwise unchanged
-- from migration 159. A function's result columns cannot be changed in place,
-- so it is dropped and created again, and its grants are given again.

drop function notewriter_ab_compare(text, text[], date);

create function notewriter_ab_compare(p_source text, p_tests text[], p_since date default null)
returns table (
  picks jsonb,
  helpful bigint, not_helpful bigint, needs_ratings bigint,
  helpful_ratings bigint, somewhat_helpful_ratings bigint, not_helpful_ratings bigint,
  -- { reason: count } over both sides.
  rating_reasons jsonb,
  -- Notes a reviewer looked at, and { failure mode: notes }.
  reviewed bigint, failure_modes jsonb,
  -- Finished runs, those whose note passed the gates, and their cost in dollars.
  runs bigint, candidate_runs bigint, cost float8,
  -- The sum of the squares of the runs' costs. The page needs it to draw the
  -- confidence interval of the cost per run.
  cost_squares float8
)
language plpgsql stable security definer set search_path = public as $$
declare
  max_tests constant int := 6;
  v_fill jsonb := x_fill_picks();
  v_projected text;
  v_complete text;
  v_run_projected text;
  v_run_complete text;
begin
  perform notewriter_source(p_source);
  if cardinality(p_tests) is null or cardinality(p_tests) = 0 then return; end if;
  if cardinality(p_tests) > max_tests then raise exception 'Compare at most % tests', max_tests; end if;
  -- A note's picks have their defaults filled in already. A run's are filled
  -- here, test by test, which is far cheaper than merging whole objects.
  select 'jsonb_build_object(' || string_agg(format('%L, f.picks ->> %L', t, t), ', ') || ')',
         string_agg(format('f.picks ? %L', t), ' and '),
         'jsonb_build_object(' || string_agg(format('%L, coalesce(p.ab_test_picks ->> %L, %L)', t, t, v_fill ->> t), ', ') || ')',
         string_agg(format('coalesce(p.ab_test_picks ->> %L, %L) is not null', t, v_fill ->> t), ' and ')
    into v_projected, v_complete, v_run_projected, v_run_complete
    from unnest(p_tests) t;
  return query execute format($q$
    with notes as (
      select %1$s as picks, f.status, r.helpful, r.somewhat_helpful, r.not_helpful, r.reasons, r.failure_modes
        from notewriter_field_rows($2) f
        left join notewriter_note_ratings($2) r on r.note_id = f.note_id
       where %2$s and ($1 is null or (f.written at time zone 'UTC')::date >= $1)
    ), note_counts as (
      select n.picks,
             count(*) filter (where n.status = 'helpful') as helpful,
             count(*) filter (where n.status = 'not_helpful') as not_helpful,
             count(*) filter (where n.status = 'needs_ratings') as needs_ratings,
             coalesce(sum(n.helpful), 0) as helpful_ratings,
             coalesce(sum(n.somewhat_helpful), 0) as somewhat_helpful_ratings,
             coalesce(sum(n.not_helpful), 0) as not_helpful_ratings,
             count(n.failure_modes) as reviewed
        from notes n group by 1
    ), reasons as (
      select r.picks, jsonb_object_agg(r.reason, r.uses) as rating_reasons
        from (select n.picks, t.key as reason, sum(t.value::bigint) as uses
                from notes n cross join lateral jsonb_each_text(coalesce(n.reasons, '{}')) t group by 1, 2) r
       group by 1
    ), modes as (
      select m.picks, jsonb_object_agg(m.mode, m.uses) as failure_modes
        from (select n.picks, u.mode, count(*) as uses
                from notes n cross join unnest(n.failure_modes) u(mode) group by 1, 2) m
       group by 1
    ), runs as (
      select %3$s as picks, count(*) as runs,
             count(*) filter (where p.candidate) as candidate_runs,
             coalesce(sum(p.cost), 0)::float8 as cost,
             coalesce(sum(p.cost * p.cost), 0)::float8 as cost_squares
        from notewriter_runs($2) p
       where p.finished and ($1 is null or p.created_at >= $1::timestamp at time zone 'UTC') and %4$s
       group by 1
    )
    select coalesce(c.picks, r.picks),
           coalesce(c.helpful, 0), coalesce(c.not_helpful, 0), coalesce(c.needs_ratings, 0),
           coalesce(c.helpful_ratings, 0)::bigint, coalesce(c.somewhat_helpful_ratings, 0)::bigint, coalesce(c.not_helpful_ratings, 0)::bigint,
           coalesce(re.rating_reasons, '{}'), coalesce(c.reviewed, 0), coalesce(m.failure_modes, '{}'),
           coalesce(r.runs, 0), coalesce(r.candidate_runs, 0), coalesce(r.cost, 0), coalesce(r.cost_squares, 0)
      from note_counts c
      full join runs r on r.picks = c.picks
      left join reasons re on re.picks = c.picks
      left join modes m on m.picks = c.picks$q$, v_projected, v_complete, v_run_projected, v_run_complete)
    using p_since, p_source;
end;
$$;

revoke all on function notewriter_ab_compare(text, text[], date) from public, anon, authenticated;
grant execute on function notewriter_ab_compare(text, text[], date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
