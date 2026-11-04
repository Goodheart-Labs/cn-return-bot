-- Migration 159: the X notewriter page and the Common Notes dashboard's notes
-- and A/B tests (GOO-635).
--
-- The X notewriter page used to be a static site on GitHub Pages that
-- downloaded one snapshot of every note and every pipeline run (236 MB). It
-- now lives on commonnotes.net and asks the database small questions through
-- the functions below, and the admin dashboard asks the same questions about
-- Common Notes. Each function returns only what one part of a page shows. They
-- run with the owner's rights (SECURITY DEFINER), so the raw tables stay
-- closed to the public key. Most take `p_source`: 'x' for our notes on X and
-- the X bot's runs, 'commonnotes' for the notes on commonnotes.net and the
-- Common Notes claim checks.
--
-- 1. Indexes, so the functions never read the large run rows.
-- 2. The A/B tests and their default arms, which the X run keeps current.
-- 3. Filter and sort helpers that work on any row type. The review page's
--    helpers of migration 153 become these, and its functions call them.
-- 4. The notes the pages filter and sort, the runs behind them, and the
--    functions the pages call.
-- 5. Who may call what.

-- 1. Indexes.

-- Every run by the day it started, with what the chart and the A/B
-- comparison count. A run row also holds its whole log, so a scan of the
-- table reads 3.5 GB, while this index is about 70 MB.
create index if not exists idx_pipeline_runs_dashboard_cover
  on pipeline_runs (created_at) include (outcome, cost, ab_test_picks);

-- The runs that produced a note, so a note finds its A/B picks.
create index if not exists idx_pipeline_runs_note_cover
  on pipeline_runs (note_id, created_at desc) include (ab_test_picks)
  where note_id is not null;

-- The same two for the Common Notes claim checks, whose rows hold their whole
-- log too. A note finds its check through its claim.
create index if not exists everything_pipeline_runs_checks_cover
  on everything_pipeline_runs (created_at) include (outcome, cost, ab_test_picks)
  where kind = 'check';
create index if not exists everything_pipeline_runs_claim_checks_cover
  on everything_pipeline_runs (claim_id, created_at desc) include (ab_test_picks)
  where kind = 'check';

-- 2. The A/B tests.

-- One row per A/B test that a run ever drew. The X run writes the tests of
-- AB_TESTS at its start through x_sync_ab_tests. Tests that left the code keep
-- their row, so old runs can still be compared on them.
create table x_ab_tests (
  test text primary key,
  -- The test's place in AB_TESTS. Null once the test has left the code.
  position int,
  -- The test's declared default arm. A run from before the test existed has
  -- no pick for it and counts as this arm, as resolvePicks does in the code.
  -- Null when the test declares none: such runs then have no arm for it.
  fill_variant text,
  -- The arm the test sits at when nobody varies it: the declared default, or
  -- else the arm with the highest weight.
  control_variant text not null,
  -- Every arm, in the code's order, then any older arms runs used.
  variants text[] not null,
  updated_at timestamptz not null default now()
);

-- No policies: only the functions below and the service role read or write it.
alter table x_ab_tests enable row level security;

-- Tests that left the code before this table existed. Their most common arm
-- stands in for the control.
insert into x_ab_tests (test, position, fill_variant, control_variant, variants)
select p.key, null, null, mode() within group (order by p.value), array_agg(distinct p.value order by p.value)
  from pipeline_runs r, jsonb_each_text(r.ab_test_picks) p
 group by p.key;

-- Writes the tests of AB_TESTS: [{ test, fill_variant, control_variant,
-- variants }] in the code's order. A test's older arms stay in its list, and
-- a test missing from the list keeps its row without a position. Rows that
-- would not change are not written.
create function x_sync_ab_tests(p_tests jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  with code as (
    select t.value ->> 'test' as test,
           t.ordinality::int - 1 as position,
           t.value ->> 'fill_variant' as fill_variant,
           t.value ->> 'control_variant' as control_variant,
           array(select jsonb_array_elements_text(t.value -> 'variants')) as variants
      from jsonb_array_elements(p_tests) with ordinality t
  ), merged as (
    select c.test, c.position, c.fill_variant, c.control_variant,
           c.variants || array(select v from unnest(coalesce(x.variants, '{}')) v where v <> all (c.variants)) as variants
      from code c
      left join x_ab_tests x on x.test = c.test
  )
  insert into x_ab_tests as x (test, position, fill_variant, control_variant, variants)
  select * from merged
  on conflict (test) do update
     set position = excluded.position, fill_variant = excluded.fill_variant, control_variant = excluded.control_variant,
         variants = excluded.variants, updated_at = now()
   where (x.position, x.fill_variant, x.control_variant, x.variants)
         is distinct from (excluded.position, excluded.fill_variant, excluded.control_variant, excluded.variants);

  update x_ab_tests set position = null, updated_at = now()
   where position is not null and test not in (select t.value ->> 'test' from jsonb_array_elements(p_tests) t);
end;
$$;

-- The arms a run counts as when it has no pick for a test, by test.
create function x_fill_picks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(test, fill_variant), '{}') from x_ab_tests where fill_variant is not null
$$;

-- 3. Filter and sort helpers for any row type.
--
-- A page lists its fields once (src/everything-core/fieldQuery.ts) and sends
-- its filters and sorts as JSON. These helpers turn that JSON into SQL against
-- one row type, and refuse any column the row type does not have. A field
-- named "picks.bot" reads the key "bot" of the jsonb column "picks". Every row
-- type has a "written" column, which settles ties, newest first.

-- The SQL type of a column of a row type, or null when it has none.
create function field_query_type(p_row regclass, p_column text) returns text
language sql stable set search_path = public as $$
  select format_type(a.atttypid, a.atttypmod)
    from pg_attribute a
   where a.attrelid = p_row and a.attname = p_column and a.attnum > 0 and not a.attisdropped
$$;

-- A column as a number, for comparing and sorting: a moment as seconds since
-- 1970, true and false as 1 and 0. Null for a text column.
create function field_query_number(p_row regclass, p_column text) returns text
language plpgsql stable set search_path = public as $$
declare
  v_type text := field_query_type(p_row, p_column);
begin
  if v_type is null then raise exception 'Unknown field %', p_column; end if;
  return case
    when v_type = 'timestamp with time zone' then format('extract(epoch from f.%I)::float8', p_column)
    when v_type = 'boolean' then format('f.%I::int::float8', p_column)
    when v_type in ('integer', 'bigint', 'double precision', 'numeric') then format('f.%I::float8', p_column)
    else null
  end;
end;
$$;

-- A column as text, for choices.
create function field_query_text(p_row regclass, p_column text) returns text
language plpgsql stable set search_path = public as $$
declare
  v_base text := split_part(p_column, '.', 1);
  v_key text := nullif(substr(p_column, length(v_base) + 2), '');
  v_type text := field_query_type(p_row, v_base);
begin
  if v_type is null then raise exception 'Unknown field %', p_column; end if;
  if v_key is null then return format('f.%I::text', v_base); end if;
  if v_type <> 'jsonb' then raise exception 'Field % has no keys', v_base; end if;
  return format('(f.%I ->> %L)', v_base, v_key);
end;
$$;

-- The condition of a request's filters, leaving out those on `p_skip_column`:
-- [{ column, min?, max? } | { column, in: [...] }], all of which must hold.
create function field_query_condition(p_row regclass, p_filters jsonb, p_skip_column text default null) returns text
language plpgsql stable set search_path = public as $$
declare
  f jsonb;
  v_number text;
  v_parts text[] := array['true'];
begin
  for f in select t.value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) t loop
    continue when f ->> 'column' = p_skip_column;
    if f ? 'in' then
      v_parts := v_parts || format('%s = any (%L::text[])', field_query_text(p_row, f ->> 'column'), array(select jsonb_array_elements_text(f -> 'in')));
    else
      v_number := field_query_number(p_row, f ->> 'column');
      if v_number is null then raise exception 'Field % is not a number', f ->> 'column'; end if;
      if f ? 'min' then v_parts := v_parts || format('%s >= %s', v_number, (f ->> 'min')::float8); end if;
      if f ? 'max' then v_parts := v_parts || format('%s <= %s', v_number, (f ->> 'max')::float8); end if;
    end if;
  end loop;
  return array_to_string(v_parts, ' and ');
end;
$$;

-- One element of a sort key: the value, negated for a descending sort, and
-- infinity when it is missing, so missing values sort last.
create function field_query_signed(p_value text, p_sort jsonb) returns text
language sql immutable as $$
  select format('coalesce(%s, ''infinity''::float8)', case when coalesce((p_sort ->> 'descending')::boolean, false) then format('-(%s)', p_value) else p_value end)
$$;

-- The sort key of a request's sorts, as an expression for an array of
-- numbers: [{ column, descending, buckets?, order? }]. It sorts in two passes.
-- The first pass takes every level in turn: a choice by its value's position
-- in `order`, worst first, a number with `buckets` by how many of those
-- ascending boundaries it reaches, and any other number by itself. Rows that
-- tie on all of that form a group, and the second pass orders each group by
-- the exact values of the bucketed levels, again in turn. The row's `written`
-- time, newest first, settles the rest. A descending level is negated in both
-- passes, and a missing value sorts last.
create function field_query_sort_key(p_row regclass, p_sorts jsonb) returns text
language plpgsql stable set search_path = public as $$
declare
  s jsonb;
  v_exact text;
  v_first text[] := '{}';
  v_second text[] := '{}';
begin
  for s in select t.value from jsonb_array_elements(coalesce(p_sorts, '[]'::jsonb)) t loop
    if s ? 'order' then
      v_first := v_first || field_query_signed(format('array_position(%L::text[], %s)::float8', array(select jsonb_array_elements_text(s -> 'order')), field_query_text(p_row, s ->> 'column')), s);
      continue;
    end if;
    v_exact := field_query_number(p_row, s ->> 'column');
    if v_exact is null then raise exception 'Field % cannot be sorted', s ->> 'column'; end if;
    if s ? 'buckets' then
      v_first := v_first || field_query_signed(format('case when %1$s is null then null else (select count(*) from unnest(%2$L::float8[]) b where b <= %1$s)::float8 end',
                                                      v_exact, array(select jsonb_array_elements_text(s -> 'buckets'))::float8[]), s);
      v_second := v_second || field_query_signed(v_exact, s);
    else
      v_first := v_first || field_query_signed(v_exact, s);
    end if;
  end loop;
  return format('array[%s]::float8[]', array_to_string(v_first || v_second || 'coalesce(-extract(epoch from f.written)::float8, 0)'::text, ', '));
end;
$$;

-- The review page's functions of migration 153, now on the shared helpers.
-- Only the helper calls changed.

create or replace function everything_review_page(p_request jsonb, p_after_key float8[] default null, p_after_id uuid default null, p_limit int default 20)
returns setof everything_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 50;
  v_reviewer text := everything_claude_actor(null);
  v_views everything_item_views := everything_item_views();
  v_ids uuid[];
  v_keys jsonb;
  v_draft everything_review_draft;
begin
  execute format($q$
      select array_agg(k.id order by k.sort_key, k.id), jsonb_agg(to_jsonb(k.sort_key) order by k.sort_key, k.id)
        from (select k.id, k.sort_key
                from (select f.id, %s as sort_key
                        from everything_review_field_rows($1, $2) f
                       where %s) k
               where $3 is null or (k.sort_key, k.id) > ($3, $4)
               order by k.sort_key, k.id
               limit $5) k$q$,
      field_query_sort_key('everything_review_field_row', p_request -> 'sorts'),
      field_query_condition('everything_review_field_row', p_request -> 'filters'))
    into v_ids, v_keys
    using v_reviewer, v_views, p_after_key, p_after_id, least(greatest(p_limit, 1), max_page_size);
  for v_draft in select * from everything_review_rows(coalesce(v_ids, '{}'), v_reviewer, v_views) loop
    v_draft.sort_key := array(select jsonb_array_elements_text(v_keys -> (array_position(v_ids, v_draft.id) - 1)))::float8[];
    return next v_draft;
  end loop;
end;
$$;

create or replace function everything_review_summary(p_request jsonb)
returns table (reviewer text, writer text, matching bigint, newest timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_matching bigint;
  v_newest timestamptz;
begin
  execute format('select count(*), max(f.written) from everything_review_field_rows($1, $2) f where %s',
                 field_query_condition('everything_review_field_row', p_request -> 'filters'))
    into v_matching, v_newest
    using v_reviewer, everything_item_views();
  return query select v_reviewer, s.writer, v_matching, v_newest from everything_claude_settings s;
end;
$$;

create or replace function everything_review_facets(p_request jsonb, p_facets jsonb)
returns table (field text, value text, label text, drafts bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_rows text[] := '{}';
  facet jsonb;
begin
  for facet in select t.value from jsonb_array_elements(coalesce(p_facets, '[]'::jsonb)) t loop
    v_rows := v_rows || format('(%L, %s, %s, %s)',
      facet ->> 'column',
      field_query_text('everything_review_field_row', facet ->> 'column'),
      case when facet ? 'label_column' then field_query_text('everything_review_field_row', facet ->> 'label_column') else 'null' end,
      field_query_condition('everything_review_field_row', p_request -> 'filters', facet ->> 'column'));
  end loop;
  if cardinality(v_rows) = 0 then return; end if;
  return query execute format($q$
    select v.field, v.value, max(v.label), count(*)
      from everything_review_field_rows($1, $2) f
     cross join lateral (values %s) v(field, value, label, passes)
     where v.passes and v.value is not null
     group by v.field, v.value$q$, array_to_string(v_rows, ', '))
    using v_reviewer, everything_item_views();
end;
$$;

drop function everything_review_number(text);
drop function everything_review_text(text);
drop function everything_review_condition(jsonb, text);
drop function everything_review_sort_key(jsonb);
drop function everything_review_signed(text, jsonb);


-- 4. The notes and runs.

-- Refuses a source other than 'x' and 'commonnotes', and returns it.
create function notewriter_source(p_source text) returns text
language plpgsql immutable as $$
begin
  if p_source is null or p_source not in ('x', 'commonnotes') then raise exception 'Unknown source %', p_source; end if;
  return p_source;
end;
$$;

-- One note as the pages filter and sort it. The pages' Filter and Sort fields
-- (src/everything-web/src/pages/notewriter/noteFields.ts) name these columns.
create type notewriter_field_row as (
  note_id text,
  written timestamptz,
  -- helpful, not_helpful or needs_ratings. On X every other status X reports
  -- counts as needs_ratings. On Common Notes it is the status the votes give.
  status text,
  -- Who wrote the note. On X the bot its run drew, such as simple-bot or
  -- claude-code. On Common Notes pipeline, claude or reader.
  writer text,
  -- How often X showed the note. Null on Common Notes.
  views int,
  -- On X every rating in the public data dump, which lags X by about 3 days.
  -- On Common Notes every vote.
  ratings int,
  -- The A/B arms of the run that wrote the note, with the default arms filled
  -- in. Null when no run wrote it, such as a reader's or Claude's note.
  picks jsonb
);

create function notewriter_field_rows(p_source text, p_ids text[] default null) returns setof notewriter_field_row
language sql stable security definer set search_path = public as $$
  -- Materialized, so the default arms are read once and not once per note.
  with fill as materialized (select x_fill_picks() as picks)
  select n.note_id,
         n.submitted_at,
         case n.cn_status
           when 'CURRENTLY_RATED_HELPFUL' then 'helpful'
           when 'CURRENTLY_RATED_NOT_HELPFUL' then 'not_helpful'
           else 'needs_ratings'
         end,
         run.ab_test_picks ->> 'bot',
         coalesce(n.view_count, 0),
         coalesce(d.helpful_count + d.somewhat_helpful_count + d.not_helpful_count, 0),
         fill.picks || run.ab_test_picks
    from notes n
   cross join fill
    left join lateral (
      select p.ab_test_picks from pipeline_runs p
       where p.note_id = n.note_id
       order by p.created_at desc
       limit 1
    ) run on true
    left join note_ratings_from_public_dump d on d.note_id = n.note_id
   where p_source = 'x' and n.submitted_at is not null and (p_ids is null or n.note_id = any (p_ids))
  union all
  select n.id::text,
         n.created_at,
         everything_note_status(n.p_helpful),
         w.writer,
         null,
         coalesce(n.helpful_count, 0) + coalesce(n.somewhat_helpful_count, 0) + coalesce(n.not_helpful_count, 0),
         case when w.writer = 'pipeline' then fill.picks || run.ab_test_picks end
    from everything_notes n
   cross join fill
   cross join lateral (
     select case
              when exists (select 1 from everything_claude_drafts c where c.note_id = n.id) then 'claude'
              when n.author_id is not null then 'reader'
              else 'pipeline'
            end as writer
   ) w
    left join lateral (
      select p.ab_test_picks from everything_pipeline_runs p
       where p.claim_id = n.claim_id and p.kind = 'check'
       order by p.created_at desc
       limit 1
    ) run on true
   where p_source = 'commonnotes' and n.status <> 'hidden' and (p_ids is null or n.id::text = any (p_ids))
$$;

-- The ratings of each note and, on X, the failure modes a reviewer tagged.
-- On X the ratings come from the public data dump and carry the raters'
-- reasons. On Common Notes they are the votes, which carry none.
create function notewriter_note_ratings(p_source text)
returns table (note_id text, helpful int, somewhat_helpful int, not_helpful int, reasons jsonb, failure_modes text[])
language sql stable security definer set search_path = public as $$
  select d.note_id, d.helpful_count, d.somewhat_helpful_count, d.not_helpful_count,
         coalesce(d.helpful_tag_counts, '{}') || coalesce(d.not_helpful_tag_counts, '{}'),
         (select a.failure_modes from review_dashboard_annotations a
           where a.source = 'production' and a.target_id = d.note_id and a.seen limit 1)
    from note_ratings_from_public_dump d
   where p_source = 'x'
  union all
  select a.target_id, null, null, null, '{}', a.failure_modes
    from review_dashboard_annotations a
   where p_source = 'x' and a.source = 'production' and a.seen
     and not exists (select 1 from note_ratings_from_public_dump d where d.note_id = a.target_id)
  union all
  select n.id::text, coalesce(n.helpful_count, 0), coalesce(n.somewhat_helpful_count, 0), coalesce(n.not_helpful_count, 0), '{}', null
    from everything_notes n
   where p_source = 'commonnotes'
$$;

-- Every pipeline run of a source. A Common Notes claim check counts as
-- submitted when it wrote a note. The function is neither SECURITY DEFINER
-- nor bound to a search_path, so Postgres can inline it into the functions
-- below, which then read only the covering indexes of section 1.
create function notewriter_runs(p_source text)
returns table (created_at timestamptz, finished boolean, candidate boolean, submitted boolean, cost float8, ab_test_picks jsonb)
language sql stable as $$
  select p.created_at, p.outcome <> 'in_progress', p.outcome in ('candidate', 'submitted'), p.outcome = 'submitted', p.cost::float8, p.ab_test_picks
    from public.pipeline_runs p
   where p_source = 'x'
  union all
  select p.created_at, true, p.outcome = 'candidate', p.outcome = 'candidate', p.cost::float8, p.ab_test_picks
    from public.everything_pipeline_runs p
   where p_source = 'commonnotes' and p.kind = 'check'
$$;

-- One X note card: the note, the post it is on, the ratings from the public
-- dump, every field of its field row as `fields`, and on a page, its
-- `sort_key`.
create type x_note_card as (
  note_id text,
  tweet_id text,
  note_text text,
  helpful_ratings int,
  somewhat_helpful_ratings int,
  not_helpful_ratings int,
  -- { reason: count } for the reasons raters gave, by side.
  helpful_tags jsonb,
  not_helpful_tags jsonb,
  post_text text,
  author_handle text,
  author_name text,
  posted_at timestamptz,
  -- The post's media and the quoted or replied-to post, as the X API sent them.
  media jsonb,
  referenced_post jsonb,
  -- quoted, replied_to or retweeted, from the post's referenced_tweets.
  referenced_kind text,
  fields jsonb,
  sort_key float8[]
);

-- The cards of these X notes, in that order. Only x_notewriter_page calls it.
create function x_note_cards(p_ids text[]) returns setof x_note_card
language sql stable security definer set search_path = public as $$
  select n.note_id, n.tweet_id, n.note_text,
         d.helpful_count, d.somewhat_helpful_count, d.not_helpful_count, d.helpful_tag_counts, d.not_helpful_tag_counts,
         t.text, t.author_handle, t.author_name, t.posted_at, t.media, t.referenced_tweet_data,
         t.referenced_tweets -> 0 ->> 'type',
         to_jsonb(f) - 'note_id',
         null::float8[]
    from notewriter_field_rows('x', p_ids) f
    join notes n on n.note_id = f.note_id
    left join tweets t on t.tweet_id = n.tweet_id
    left join note_ratings_from_public_dump d on d.note_id = n.note_id
   order by array_position(p_ids, f.note_id);
$$;

-- One page of the X notes that pass the request's filters, in its order,
-- starting after the note with sort key `p_after_key` and id `p_after_id`.
create function x_notewriter_page(p_request jsonb, p_after_key float8[] default null, p_after_id text default null, p_limit int default 10)
returns setof x_note_card
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 50;
  v_ids text[];
  v_keys jsonb;
  v_card x_note_card;
begin
  execute format($q$
      select array_agg(k.note_id order by k.sort_key, k.note_id), jsonb_agg(to_jsonb(k.sort_key) order by k.sort_key, k.note_id)
        from (select k.note_id, k.sort_key
                from (select f.note_id, %s as sort_key from notewriter_field_rows('x') f where %s) k
               where $1 is null or (k.sort_key, k.note_id) > ($1, $2)
               order by k.sort_key, k.note_id
               limit $3) k$q$,
      field_query_sort_key('notewriter_field_row', p_request -> 'sorts'),
      field_query_condition('notewriter_field_row', p_request -> 'filters'))
    into v_ids, v_keys
    using p_after_key, p_after_id, least(greatest(p_limit, 1), max_page_size);
  for v_card in select * from x_note_cards(coalesce(v_ids, '{}')) loop
    v_card.sort_key := array(select jsonb_array_elements_text(v_keys -> (array_position(v_ids, v_card.note_id) - 1)))::float8[];
    return next v_card;
  end loop;
end;
$$;

-- The headline numbers of the notes that pass the request's filters.
create function notewriter_summary(p_source text, p_request jsonb)
returns table (notes bigint, helpful bigint, views bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  return query execute format(
    $q$select count(*), count(*) filter (where f.status = 'helpful'), coalesce(sum(f.views), 0)::bigint
         from notewriter_field_rows($1) f where %s$q$,
    field_query_condition('notewriter_field_row', p_request -> 'filters'))
    using notewriter_source(p_source);
end;
$$;

-- How many notes each value of the given choice fields holds: [{ column }].
-- Each field's count leaves out its own filter, so the Filter menu shows what
-- picking another value would give.
create function notewriter_facets(p_source text, p_request jsonb, p_facets jsonb)
returns table (field text, value text, notes bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows text[] := '{}';
  facet jsonb;
begin
  for facet in select t.value from jsonb_array_elements(coalesce(p_facets, '[]'::jsonb)) t loop
    v_rows := v_rows || format('(%L, %s, %s)',
      facet ->> 'column',
      field_query_text('notewriter_field_row', facet ->> 'column'),
      field_query_condition('notewriter_field_row', p_request -> 'filters', facet ->> 'column'));
  end loop;
  if cardinality(v_rows) = 0 then return; end if;
  return query execute format($q$
    select v.field, v.value, count(*)
      from notewriter_field_rows($1) f
     cross join lateral (values %s) v(field, value, passes)
     where v.passes and v.value is not null
     group by v.field, v.value$q$, array_to_string(v_rows, ', '))
    using notewriter_source(p_source);
end;
$$;

-- The notes that pass the request's filters, counted by the UTC day they were
-- written and their status. With `p_with_runs`, also every pipeline run of
-- that day and how many of them submitted a note. The runs only take the
-- request's A/B filters, because the other fields describe notes.
create function notewriter_days(p_source text, p_request jsonb, p_with_runs boolean default false)
returns table (day date, helpful bigint, not_helpful bigint, needs_ratings bigint, runs bigint, submitted_runs bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_fill jsonb := x_fill_picks();
  v_pick_filters jsonb := coalesce((
    select jsonb_agg(t.value) from jsonb_array_elements(p_request -> 'filters') t where t.value ->> 'column' like 'picks.%'
  ), '[]');
begin
  return query execute format($q$
    with notes as (
      select (f.written at time zone 'UTC')::date as day,
             count(*) filter (where f.status = 'helpful') as helpful,
             count(*) filter (where f.status = 'not_helpful') as not_helpful,
             count(*) filter (where f.status = 'needs_ratings') as needs_ratings
        from notewriter_field_rows($3) f
       where %s
       group by 1
    ), runs as (
      select (f.written at time zone 'UTC')::date as day, count(*) as runs, count(*) filter (where f.submitted) as submitted_runs
        from (select r.created_at as written, r.submitted, $2 || coalesce(r.ab_test_picks, '{}') as picks
                from notewriter_runs($3) r
               where $1) f
       where %s
       group by 1
    )
    select coalesce(n.day, r.day), coalesce(n.helpful, 0), coalesce(n.not_helpful, 0), coalesce(n.needs_ratings, 0),
           coalesce(r.runs, 0), coalesce(r.submitted_runs, 0)
      from notes n
      full join runs r on r.day = n.day
     order by 1$q$,
    field_query_condition('notewriter_field_row', p_request -> 'filters'),
    field_query_condition('notewriter_field_row', v_pick_filters))
    using p_with_runs, v_fill, notewriter_source(p_source);
end;
$$;

-- The "% of all notes" chart of the X page: the notes rated helpful on X
-- each day, and how many of them we and the nine most productive other AI
-- note writers wrote.
create function x_notewriter_origin_days()
returns table (day date, helpful_total int, helpful_ours int, helpful_other_ai int)
language sql stable security definer set search_path = public as $$
  select day, helpful_total, helpful_ours, helpful_other_ai from daily_note_origin_counts order by day
$$;

-- The A/B tests a source's page offers, in the code's order and then the
-- retired ones, with their arms and whether a run of the last 3 days drew
-- another arm than the control. X offers every test a run ever drew. Common
-- Notes offers only the tests on which one of its claim checks ever drew
-- another arm than the control, because it forces most arms.
create function notewriter_tests(p_source text)
returns table (test text, live boolean, control_variant text, variants text[], recently_varied boolean)
language sql stable security definer set search_path = public as $$
  with fill as materialized (select x_fill_picks() as picks),
  -- The distinct sets of picks, which are far fewer than the runs.
  combos as materialized (
    select fill.picks || coalesce(r.ab_test_picks, '{}') as picks, max(r.created_at) as last_at
      from notewriter_runs(p_source) r
     cross join fill
     where p_source = 'commonnotes' or r.created_at > now() - interval '3 days'
     group by 1
  ), varied as (
    select t.test, max(c.last_at) as last_varied
      from combos c
      join x_ab_tests t on c.picks ->> t.test <> t.control_variant
     group by 1
  )
  select t.test, t.position is not null, t.control_variant, t.variants, coalesce(v.last_varied > now() - interval '3 days', false)
    from x_ab_tests t
    left join varied v on v.test = t.test
   where p_source = 'x' or v.test is not null
   order by t.position nulls last, t.test
$$;

-- The failure modes the reviewers tagged and the reasons raters gave, over
-- every note of a source, most common first. They fill the Metric menu's
-- submenus. Common Notes has neither yet.
create function notewriter_reasons(p_source text)
returns table (kind text, reason text, uses bigint)
language sql stable security definer set search_path = public as $$
  select 'failure_mode', m.mode, count(*)
    from notewriter_note_ratings(p_source) r
    join notewriter_field_rows(p_source) f on f.note_id = r.note_id
   cross join unnest(r.failure_modes) m(mode)
   group by 2
  union all
  select 'rating_reason', t.key, sum(t.value::bigint)
    from notewriter_note_ratings(p_source) r
    join notewriter_field_rows(p_source) f on f.note_id = r.note_id
   cross join lateral jsonb_each_text(r.reasons) t
   group by 2
  order by 1, 3 desc, 2
$$;

-- The A/B comparison: the notes and the finished runs since `p_since` (a UTC
-- day, or null for all time), grouped by the arms they drew on `p_tests`. A
-- note or run without an arm for one of the tests is left out. Each row has
-- the counts every metric of the page needs. Notes and runs are counted apart:
-- a submitted run can lack a note row and the other way round.
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
  runs bigint, candidate_runs bigint, cost float8
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
             coalesce(sum(p.cost), 0)::float8 as cost
        from notewriter_runs($2) p
       where p.finished and ($1 is null or p.created_at >= $1::timestamp at time zone 'UTC') and %4$s
       group by 1
    )
    select coalesce(c.picks, r.picks),
           coalesce(c.helpful, 0), coalesce(c.not_helpful, 0), coalesce(c.needs_ratings, 0),
           coalesce(c.helpful_ratings, 0)::bigint, coalesce(c.somewhat_helpful_ratings, 0)::bigint, coalesce(c.not_helpful_ratings, 0)::bigint,
           coalesce(re.rating_reasons, '{}'), coalesce(c.reviewed, 0), coalesce(m.failure_modes, '{}'),
           coalesce(r.runs, 0), coalesce(r.candidate_runs, 0), coalesce(r.cost, 0)
      from note_counts c
      full join runs r on r.picks = c.picks
      left join reasons re on re.picks = c.picks
      left join modes m on m.picks = c.picks$q$, v_projected, v_complete, v_run_projected, v_run_complete)
    using p_since, p_source;
end;
$$;

-- 5. Who may call what.

revoke all on function
  x_sync_ab_tests(jsonb),
  x_fill_picks(),
  field_query_type(regclass, text),
  field_query_number(regclass, text),
  field_query_text(regclass, text),
  field_query_condition(regclass, jsonb, text),
  field_query_signed(text, jsonb),
  field_query_sort_key(regclass, jsonb),
  notewriter_source(text),
  notewriter_field_rows(text, text[]),
  notewriter_note_ratings(text),
  notewriter_runs(text),
  x_note_cards(text[]),
  x_notewriter_page(jsonb, float8[], text, int),
  notewriter_summary(text, jsonb),
  notewriter_facets(text, jsonb, jsonb),
  notewriter_days(text, jsonb, boolean),
  x_notewriter_origin_days(),
  notewriter_tests(text),
  notewriter_reasons(text),
  notewriter_ab_compare(text, text[], date)
from public, anon, authenticated;

grant execute on function x_sync_ab_tests(jsonb) to service_role;

-- Both pages are open to the public key, like the admin dashboard's other
-- functions: the X page is public, developer mode included (Jim,
-- 2026-10-29), and everything here was public on the old GitHub Pages page.
grant execute on function
  x_notewriter_page(jsonb, float8[], text, int),
  notewriter_summary(text, jsonb),
  notewriter_facets(text, jsonb, jsonb),
  notewriter_days(text, jsonb, boolean),
  x_notewriter_origin_days(),
  notewriter_tests(text),
  notewriter_reasons(text),
  notewriter_ab_compare(text, text[], date)
to anon, authenticated, service_role;

notify pgrst, 'reload schema';
