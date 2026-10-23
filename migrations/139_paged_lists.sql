-- 139: real page-by-page loading for every growing list on commonnotes.net
-- (GOO-524).
--
-- Until now the website downloaded whole lists and showed them a slice at a
-- time. All notes downloaded every visible note on the site, 2,884 of them on
-- 2026-10-23, and ranked, filtered and sorted them in the browser. The
-- functions below do that work in the database instead. Each one returns one
-- page, and the website asks for the next page as the reader scrolls.
--
-- The pages are keyset paged. A keyset page does not say "skip the first 60
-- rows". It says "start right after this row", naming the last row of the page
-- before by the values the list is sorted on. So a note that arrives or moves
-- while the reader scrolls can never push another note out of the list or show
-- it twice.
--
-- 1. The chance that a note ends up rated helpful, as two stored columns.
-- 2. The notes feed: one page, and a summary with the counts the page shows.
-- 3. The creators overview, and one creator's posts.
-- 4. The admins' best-notes curation: one page, and a summary.


-- 1. The chance that a note ends up rated helpful.
--
-- The website's feed ranks notes by this chance. It is the same model as
-- probabilityHelpful in src/everything-core/noteBelief.ts: a Beta prior on the
-- share of raters who would call the note helpful, updated by the note's votes,
-- and the chance is the posterior mass above X's bar of 0.4. Computing it needs
-- the regularized incomplete beta function, which Postgres does not have. So
-- the three functions below are a line-by-line port of
-- src/everything-core/incompleteBeta.ts. The constants must stay equal to the
-- ones in noteBelief.ts and noteScore.ts, and noteBelief.sql.test.ts checks
-- that they do. The calls between them name the schema, because a restore
-- from a backup runs with an empty search path, and it computes the stored
-- columns below with these functions.

create function everything_log_gamma(x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  coefficients constant float8[] := array[
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z float8 := x - 1;
  series float8 := 0.99999999999980993;
  t float8;
begin
  -- The reflection formula keeps the series in its convergent range.
  if x < 0.5 then
    return ln(pi() / sin(pi() * x)) - public.everything_log_gamma(1 - x);
  end if;
  for i in 1..8 loop
    series := series + coefficients[i] / (z + i);
  end loop;
  t := z + 7.5;
  return 0.5 * ln(2 * pi()) + (z + 0.5) * ln(t) - t + ln(series);
end;
$$;

-- The continued fraction for the incomplete beta function. It converges
-- quickly when x is below (a + 1) / (a + b + 2).
create function everything_beta_continued_fraction(a float8, b float8, x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  max_iterations constant int := 300;
  relative_tolerance constant float8 := 3e-14;
  -- This value only guards against a division by zero.
  tiny constant float8 := 1e-300;
  c float8 := 1;
  d float8 := 1 - (a + b) * x / (a + 1);
  result float8;
  numerator float8;
  step float8;
begin
  if abs(d) < tiny then d := tiny; end if;
  d := 1 / d;
  result := d;
  for m in 1..max_iterations loop
    -- The even step of the recurrence.
    numerator := m * (b - m) * x / ((a - 1 + 2 * m) * (a + 2 * m));
    d := 1 + numerator * d;
    if abs(d) < tiny then d := tiny; end if;
    c := 1 + numerator / c;
    if abs(c) < tiny then c := tiny; end if;
    d := 1 / d;
    result := result * d * c;
    -- The odd step of the recurrence.
    numerator := -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 1 + 2 * m));
    d := 1 + numerator * d;
    if abs(d) < tiny then d := tiny; end if;
    c := 1 + numerator / c;
    if abs(c) < tiny then c := tiny; end if;
    d := 1 / d;
    step := d * c;
    result := result * step;
    exit when abs(step - 1) < relative_tolerance;
  end loop;
  return result;
end;
$$;

-- The regularized incomplete beta function I_x(a, b), which is the cumulative
-- distribution function of Beta(a, b).
create function everything_incomplete_beta(a float8, b float8, x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  front float8;
begin
  if x <= 0 then return 0; end if;
  if x >= 1 then return 1; end if;
  front := exp(public.everything_log_gamma(a + b) - public.everything_log_gamma(a) - public.everything_log_gamma(b) + a * ln(x) + b * ln(1 - x));
  -- On the far side the mirrored fraction converges faster.
  if x < (a + 1) / (a + b + 2) then
    return front * public.everything_beta_continued_fraction(a, b, x) / a;
  end if;
  return 1 - front * public.everything_beta_continued_fraction(b, a, 1 - x) / b;
end;
$$;

-- The chance that a note with these votes ends up rated helpful. The prior
-- weighs about five imagined votes, a Somewhat helpful vote counts as half a
-- Helpful vote, and 0.4 is X's bar for a helpful note.
create function everything_probability_helpful(helpful int, somewhat_helpful int, not_helpful int) returns float8
language sql immutable parallel safe as $$
  select 1 - public.everything_incomplete_beta(
    1.6806912990301406::float8 + helpful + 0.5 * somewhat_helpful,
    3.3193087009698594::float8 + not_helpful,
    0.4::float8);
$$;

-- A note's rating state from that chance, as noteStatus in
-- src/everything-core/noteScore.ts decides it.
create function everything_note_status(p_helpful float8) returns text
language sql immutable parallel safe as $$
  select case when p_helpful >= 0.78 then 'helpful' when p_helpful <= 0.2 then 'not_helpful' else 'needs_ratings' end;
$$;

-- The two chances the feed sorts by, stored on every note. Postgres computes a
-- stored generated column whenever the row changes, so the vote counter trigger
-- keeps them current, and no page request has to evaluate the continued
-- fraction for thousands of notes. The author's own Helpful vote is taken out,
-- as noteTally does, because a trigger casts it automatically and it tells us
-- nothing. The second column is where the chance would land after one more
-- Helpful vote, which is how the feed ranks the notes that need ratings.
alter table everything_notes
  add column p_helpful float8 generated always as (
    public.everything_probability_helpful(greatest(helpful_count - (author_id is not null)::int, 0), somewhat_helpful_count, not_helpful_count)
  ) stored,
  add column p_helpful_after_helpful float8 generated always as (
    public.everything_probability_helpful(greatest(helpful_count - (author_id is not null)::int, 0) + 1, somewhat_helpful_count, not_helpful_count)
  ) stored;

comment on column everything_notes.p_helpful is
  'The chance that the note ends up rated helpful, from its votes without the author''s own (migration 139). The website''s feed sorts by it.';
comment on column everything_notes.p_helpful_after_helpful is
  'Where p_helpful would land after one more Helpful vote (migration 139). The feed ranks notes that need ratings by it.';


-- 2. The notes feed.
--
-- All notes and a creator's page show the same feed, so one function serves
-- both. The reader picks one of three orders.
--
-- * mixed: the order every creator's page uses. The three most helpful notes
--   lead, then one note that needs ratings alternates with one more helpful
--   note. Unhelpful notes follow in a band of their own, and notes whose source
--   text has since changed come last, in a third band.
-- * recent: every note, newest first.
-- * helpful: every note, by its chance of ending up helpful.
--
-- These orders used to be computed by rankFeed and arrangeFeed in
-- src/everything-web/src/lib/feed.ts. The orders here are the same, with one
-- difference: the browser used the vote counts each note had when the reader
-- first saw it, so no card moved while the reader voted. The pages here are
-- ranked by the counts at the moment each page loads. A page that has loaded
-- is never ranked again, so a card still never moves under the reader.

-- What narrows the feed: a project or one of its items, and the reader's
-- filters. A minimum of 0 and false let every note through. With
-- unvoted_only, the notes the reader had voted on before `voted_before` are
-- left out. The website passes the moment the reader opened the feed. So a
-- vote cast while reading never makes its card vanish, not even when the feed
-- reloads, and the reader can still change the vote.
create type everything_feed_scope as (
  project_id uuid,
  item_id uuid,
  min_views int,
  min_votes int,
  min_helpful int,
  min_not_helpful int,
  unvoted_only boolean,
  voted_before timestamptz
);

-- One note as the feed sorts and filters it. `band` is the note's rating
-- state, or 'stale' when the source text has changed since we quoted it. `content` is the note's place in
-- its post, which breaks every tie: by the clip timestamp, then the age of the
-- improvement chain the note belongs to, then originals before improvements,
-- then the older note first. `views` counts the devices outside the team that
-- were shown the post's notes (migration 128). `passes` says whether the
-- note passes the reader's filters.
create type everything_feed_candidate as (
  id uuid,
  item_id uuid,
  created_at timestamptz,
  band text,
  p_helpful float8,
  p_helpful_after_helpful float8,
  votes int,
  helpful_count int,
  not_helpful_count int,
  views bigint,
  item_epoch float8,
  content float8[],
  passes boolean
);

-- Every visible note in the scope. Each page and each summary computes this
-- list once and reads it as often as it needs.
create function everything_feed_candidates(p_scope everything_feed_scope)
returns setof everything_feed_candidate
language sql stable security definer set search_path = public as $$
  with recursive scoped as (
    select n.id, n.improved_from_note_id, n.created_at, n.p_helpful, n.p_helpful_after_helpful,
           n.helpful_count, n.somewhat_helpful_count, n.not_helpful_count,
           c.item_id, c.start_seconds, c.updated_quote is not null as stale,
           coalesce(i.published_at::timestamptz, i.created_at) as item_date
      from everything_notes n
      join everything_claims c on c.id = n.claim_id
      join everything_items i on i.id = c.item_id
     where n.status <> 'hidden'
       and (p_scope.project_id is null or i.project_id = p_scope.project_id)
       and (p_scope.item_id is null or c.item_id = p_scope.item_id)
  ),
  -- Walks every improvement up its chain of earlier notes. The deepest step
  -- reached is the chain's first note. Only the few notes that improve
  -- another one are walked, wherever they are, and each step looks the
  -- earlier note up by its id. An improvement sits on the same claim as the
  -- note it improves, so its chain never leaves the scope. A note that improves nothing is the first note of its own chain. A
  -- hidden note ends the walk, as the browser's walk ended at a note it did
  -- not have. The depth limit only guards against a cycle.
  ancestors (id, parent_id, ancestor_created_at, depth) as (
    select n.id, n.improved_from_note_id, n.created_at, 0 from everything_notes n where n.improved_from_note_id is not null and n.status <> 'hidden'
    union all
    select a.id, p.improved_from_note_id, p.created_at, a.depth + 1
      from ancestors a
      join everything_notes p on p.id = a.parent_id and p.status <> 'hidden'
     where a.depth < 50
  ),
  roots as (
    select distinct on (a.id) a.id, a.ancestor_created_at as root_created_at
      from ancestors a
     order by a.id, a.depth desc
  ),
  -- The extension writes the item id into a view event, so it is read as
  -- text, and only a well-formed id is turned into one. Joining on ids rather
  -- than text lets Postgres match the counts to the notes with a hash table
  -- instead of sorting every note. The counts are computed once, before the
  -- join, so the function never runs once per note.
  viewers as materialized (
    select v.item_id::uuid as item_id, v.viewers
      from everything_item_note_viewers() v
     where v.item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select s.id, s.item_id, s.created_at,
         case when s.stale then 'stale' else everything_note_status(s.p_helpful) end,
         s.p_helpful, s.p_helpful_after_helpful,
         s.helpful_count + s.somewhat_helpful_count + s.not_helpful_count,
         s.helpful_count, s.not_helpful_count,
         coalesce(v.viewers, 0),
         extract(epoch from s.item_date)::float8,
         array[coalesce(s.start_seconds, 0)::float8,
               extract(epoch from coalesce(r.root_created_at, s.created_at))::float8,
               (s.improved_from_note_id is not null)::int::float8,
               extract(epoch from s.created_at)::float8],
         coalesce(v.viewers, 0) >= coalesce(p_scope.min_views, 0)
           and s.helpful_count + s.somewhat_helpful_count + s.not_helpful_count >= coalesce(p_scope.min_votes, 0)
           and s.helpful_count >= coalesce(p_scope.min_helpful, 0)
           and s.not_helpful_count >= coalesce(p_scope.min_not_helpful, 0)
           -- A note the reader wrote counts as voted on, because posting a
           -- note casts a Helpful vote on it.
           and not (coalesce(p_scope.unvoted_only, false) and exists (
             select 1 from everything_votes ev
              where ev.note_id = s.id and ev.voter_id = auth.uid() and ev.created_at < coalesce(p_scope.voted_before, now())))
    from scoped s
    left join roots r on r.id = s.id
    left join viewers v on v.item_id = s.item_id;
$$;

-- One stream of the feed: the notes of the given bands among `p_candidates`
-- in one sort order, starting right after the position `p_after`. Every sort order ends in the
-- post's date (newest first), the post's id and the note's place in the post,
-- so the notes of one post stay together on a tie. The note's id comes last,
-- which makes every position unique. Each order puts its values into one
-- array, negated where the order is descending, so a single comparison of
-- (key, item_id, content, id) finds the rows after a position.
--
-- * helpful: the chance of ending up helpful, then more votes first.
-- * needs_ratings: how far one more Helpful vote would push the note, then
--   the oldest note first, because that is where a rating settles the most.
-- * best: the chance of ending up helpful alone.
-- * recent: the newest note first.
create function everything_feed_stream(p_candidates everything_feed_candidate[], p_bands text[], p_key text, p_after jsonb, p_limit int)
returns table (id uuid, item_id uuid, key float8[], content float8[], views bigint)
language sql stable security definer set search_path = public as $$
  with keyed as (
    select c.id, c.item_id, c.content, c.views,
           case p_key
             when 'helpful' then array[-c.p_helpful, -c.votes, -c.item_epoch]
             when 'needs_ratings' then array[-c.p_helpful_after_helpful, extract(epoch from c.created_at)::float8, -c.item_epoch]
             when 'best' then array[-c.p_helpful, -c.item_epoch]
             when 'recent' then array[-extract(epoch from c.created_at)::float8, -c.item_epoch]
           end as key
      from unnest(p_candidates) c
     where c.band = any (p_bands)
  )
  select k.id, k.item_id, k.key, k.content, k.views
    from keyed k
   where p_after is null
      or (k.key, k.item_id, k.content, k.id) > (
           array(select jsonb_array_elements_text(p_after -> 'key')::float8),
           (p_after ->> 'item_id')::uuid,
           array(select jsonb_array_elements_text(p_after -> 'content')::float8),
           (p_after ->> 'id')::uuid)
   order by k.key, k.item_id, k.content, k.id
   limit p_limit;
$$;

-- One page of the feed, as {"notes": [{"id", "band", "views"}], "next": <position>}.
-- `band` names the band of the mixed order a note belongs to: main, unhelpful
-- or stale. The other two orders put every note in the band 'all'. `views`
-- counts the devices outside the team that were shown the post's notes. `next` is
-- what the website passes as p_after to get the following page, and it is null
-- after the last page. The website treats it as an opaque bookmark.
--
-- The mixed order's main band interleaves two streams, the helpful notes and
-- the notes that need ratings. Its bookmark holds a position in each stream
-- and how many notes each stream has given so far. The count of notes taken
-- fixes each note's place in the interleaving: helpful note i sits at place i
-- for the three leading notes and at 2i - 2 after them, and the j-th note that
-- needs ratings sits at 3 + 2j. When one stream runs out, the other follows on
-- its own in its order. A note only ever moves when its own votes change, so a
-- vote between two pages can never skip a note or show one twice.
--
-- A page is filled from the next band when its band runs out. Only the last
-- page is shorter than p_limit.
create function everything_note_feed_page(
  p_project_id uuid default null,
  p_item_id uuid default null,
  p_order text default 'mixed',
  p_min_views int default 0,
  p_min_votes int default 0,
  p_min_helpful int default 0,
  p_min_not_helpful int default 0,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null,
  p_after jsonb default null,
  p_limit int default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 100;
  leading_helpful_notes constant int := 3;
  scope everything_feed_scope := row(p_project_id, p_item_id, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before);
  candidates everything_feed_candidate[] := array(select c from everything_feed_candidates(scope) c where c.passes);
  bands text[] := case p_order
    when 'mixed' then array['main', 'unhelpful', 'stale']
    when 'recent' then array['all']
    when 'helpful' then array['all']
  end;
  band_index int;
  band text;
  remaining int := least(greatest(p_limit, 1), max_page_size);
  notes jsonb := '[]';
  bookmark jsonb := p_after;
  taken int;
  helpful_after jsonb;
  helpful_taken int;
  needs_after jsonb;
  needs_taken int;
  r record;
begin
  if bands is null then raise exception 'Unknown order %', p_order; end if;
  band_index := coalesce(array_position(bands, bookmark ->> 'band'), 1);
  while band_index <= cardinality(bands) loop
    band := bands[band_index];
    taken := 0;
    if band = 'main' then
      helpful_after := bookmark -> 'helpful';
      helpful_taken := coalesce((bookmark ->> 'helpful_taken')::int, 0);
      needs_after := bookmark -> 'needs';
      needs_taken := coalesce((bookmark ->> 'needs_taken')::int, 0);
      for r in
        with helpful as (
          select s.*, helpful_taken - 1 + row_number() over (order by s.key, s.item_id, s.content, s.id) as taken_index
            from everything_feed_stream(candidates, array['helpful'], 'helpful', helpful_after, remaining) s
        ),
        needs as (
          select s.*, needs_taken - 1 + row_number() over (order by s.key, s.item_id, s.content, s.id) as taken_index
            from everything_feed_stream(candidates, array['needs_ratings'], 'needs_ratings', needs_after, remaining) s
        )
        select * from (
          select 'helpful' as stream, h.*,
                 case when h.taken_index < leading_helpful_notes then h.taken_index else 2 * h.taken_index - 2 end as place
            from helpful h
          union all
          select 'needs', n.*, leading_helpful_notes + 2 * n.taken_index from needs n
        ) merged
        order by place
        limit remaining
      loop
        notes := notes || jsonb_build_object('id', r.id, 'band', band, 'views', r.views);
        if r.stream = 'helpful' then
          helpful_after := jsonb_build_object('key', r.key, 'item_id', r.item_id, 'content', r.content, 'id', r.id);
          helpful_taken := r.taken_index + 1;
        else
          needs_after := jsonb_build_object('key', r.key, 'item_id', r.item_id, 'content', r.content, 'id', r.id);
          needs_taken := r.taken_index + 1;
        end if;
        taken := taken + 1;
      end loop;
      bookmark := jsonb_build_object('band', band, 'helpful', helpful_after, 'helpful_taken', helpful_taken, 'needs', needs_after, 'needs_taken', needs_taken);
    else
      for r in
        select * from everything_feed_stream(
          candidates,
          case band when 'unhelpful' then array['not_helpful'] when 'stale' then array['stale']
                    else array['helpful', 'needs_ratings', 'not_helpful', 'stale'] end,
          case when band in ('unhelpful', 'stale') then 'best' when p_order = 'recent' then 'recent' else 'helpful' end,
          bookmark -> 'after',
          remaining)
      loop
        notes := notes || jsonb_build_object('id', r.id, 'band', band, 'views', r.views);
        bookmark := jsonb_build_object('band', band, 'after', jsonb_build_object('key', r.key, 'item_id', r.item_id, 'content', r.content, 'id', r.id));
        taken := taken + 1;
      end loop;
    end if;
    remaining := remaining - taken;
    -- A full page stops here. The band may hold more, and the bookmark points
    -- right after the page's last note.
    exit when remaining = 0;
    -- The band ran out, so the page continues with the next band from its start.
    band_index := band_index + 1;
    bookmark := null;
  end loop;
  return jsonb_build_object('notes', notes, 'next', case when band_index > cardinality(bands) then null else bookmark end);
end;
$$;

-- The counts the feed shows besides its pages, for the same scope and filters.
-- `matching` is how many notes pass the filters. `bands` counts them per band
-- of the mixed order, for the band dividers. `since` counts the notes created
-- at or after each of the given moments, which is how the website labels the
-- newest order's dividers (Today, Yesterday, Last 7 days and so on) in the
-- reader's own time zone. `largest` is the largest value each filter takes
-- among all notes in the scope, whatever the filters, which sets the range of
-- the filter controls.
create function everything_note_feed_summary(
  p_project_id uuid default null,
  p_item_id uuid default null,
  p_min_views int default 0,
  p_min_votes int default 0,
  p_min_helpful int default 0,
  p_min_not_helpful int default 0,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null,
  p_since timestamptz[] default '{}'
) returns jsonb
language sql stable security definer set search_path = public as $$
  with everything_in_scope as materialized (
    select * from everything_feed_candidates(row(p_project_id, p_item_id, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before))
  ),
  matching as (
    select * from everything_in_scope where passes
  )
  select jsonb_build_object(
    'matching', (select count(*) from matching),
    'bands', (select jsonb_build_object(
                'main', count(*) filter (where band in ('helpful', 'needs_ratings')),
                'unhelpful', count(*) filter (where band = 'not_helpful'),
                'stale', count(*) filter (where band = 'stale'))
                from matching),
    'since', (select coalesce(jsonb_agg((select count(*) from matching m where m.created_at >= s.at) order by s.n), '[]')
                from unnest(p_since) with ordinality s(at, n)),
    'largest', (select jsonb_build_object(
                  'views', coalesce(max(views), 0),
                  'votes', coalesce(max(votes), 0),
                  'helpful', coalesce(max(helpful_count), 0),
                  'not_helpful', coalesce(max(not_helpful_count), 0))
                  from everything_in_scope)
  );
$$;


-- 3. The creators overview, and one creator's posts.

-- One page of the creators overview: the projects with at least one visible
-- note, either by the votes on their notes or by name. The scores and counts
-- come from everything_projects_by_votes (migration 106). Keyset paged on the
-- sort values of the previous page's last project.
create function everything_projects_page(
  p_order text default 'votes',
  p_after_score numeric default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit int default 30
) returns table (id uuid, slug text, name text, feed_url text, avatar_url text, vote_score numeric, note_count bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.slug, p.name, p.feed_url, p.avatar_url, p.vote_score, p.note_count
    from everything_projects_by_votes() p
   where p.note_count > 0
     and (p_after_id is null
          or (p_order = 'votes' and (-p.vote_score, lower(p.name), p.id) > (-p_after_score, lower(p_after_name), p_after_id))
          or (p_order = 'name' and (lower(p.name), p.id) > (lower(p_after_name), p_after_id)))
   order by case when p_order = 'votes' then -p.vote_score end, lower(p.name), p.id
   limit least(greatest(p_limit, 1), 100);
$$;

-- One page of a creator's posts that have visible notes, newest first, with
-- how many notes each has. A post's date is the day it was published, or the
-- moment we first saw it when that day is unknown.
create function everything_project_items_page(
  p_project_id uuid,
  p_before_date timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 30
) returns table (id uuid, project_id uuid, url text, title text, published_at date, created_at timestamptz, note_count bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.project_id, i.url, i.title, i.published_at, i.created_at, count(*)
    from everything_items i
    join everything_claims c on c.item_id = i.id
    join everything_notes n on n.claim_id = c.id
   where i.project_id = p_project_id
     and n.status <> 'hidden'
     and (p_before_id is null or (coalesce(i.published_at::timestamptz, i.created_at), i.id) < (p_before_date, p_before_id))
   group by i.id
   order by coalesce(i.published_at::timestamptz, i.created_at) desc, i.id desc
   limit least(greatest(p_limit, 1), 100);
$$;


-- 4. The admins' best-notes curation (migrations 136 to 138).

-- One page of a curation section. The two lists are ordered by position,
-- smallest first, and the removed recommendations by when they were removed,
-- the most recent first. `sort_key` carries that order for the keyset: the
-- position, or the removal time as negative seconds. A note that was deleted
-- or hidden is left out. The filters narrow the section to one creator, to
-- leaderboard notes not yet posted on X, or to notes the admin had not voted
-- on before `p_voted_before`, as in the notes feed.
create function everything_curation_page(
  p_section text,
  p_project_slug text default null,
  p_not_posted_only boolean default false,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null,
  p_after_key float8 default null,
  p_after_note_id uuid default null,
  p_limit int default 30
) returns table (note_id uuid, sort_key float8, "position" float8, comment text, posted_at timestamptz, removed_at timestamptz, removed_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not everything_is_admin() then raise exception 'Only admins can read the curation'; end if;
  if p_section not in ('recommendations', 'leaderboard', 'removed') then raise exception 'Unknown section %', p_section; end if;
  return query
    with section_rows as (
      select b.note_id, b.position as sort_key, b.position, b.comment, b.posted_at, null::timestamptz as removed_at, null::text as removed_reason
        from everything_best_notes b
       where p_section = 'leaderboard'
      union all
      select r.note_id, r.position, r.position, r.comment, null, null, null
        from everything_note_recommendations r
       where p_section = 'recommendations' and r.moved_at is null and r.removed_at is null
      union all
      select r.note_id, -extract(epoch from r.removed_at)::float8, null, null, null, r.removed_at, r.removed_reason
        from everything_note_recommendations r
       where p_section = 'removed' and r.removed_at is not null
    )
    select s.note_id, s.sort_key, s.position, s.comment, s.posted_at, s.removed_at, s.removed_reason
      from section_rows s
      join everything_notes n on n.id = s.note_id and n.status <> 'hidden'
      join everything_claims c on c.id = n.claim_id
      join everything_items i on i.id = c.item_id
      left join everything_projects p on p.id = i.project_id
     where (p_project_slug is null or p.slug = p_project_slug)
       and (not p_not_posted_only or s.posted_at is null)
       and (not p_unvoted_only or not exists (
             select 1 from everything_votes v
              where v.note_id = s.note_id and v.voter_id = auth.uid() and v.created_at < coalesce(p_voted_before, now())))
       and (p_after_note_id is null or (s.sort_key, s.note_id) > (p_after_key, p_after_note_id))
     order by s.sort_key, s.note_id
     limit least(greatest(p_limit, 1), 100);
end;
$$;

-- What the curation sidebar shows: how many notes each section holds, and the
-- creators with notes in the given section, the most notes first.
create function everything_curation_summary(p_section text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not everything_is_admin() then raise exception 'Only admins can read the curation'; end if;
  with section_notes as (
    select 'leaderboard' as section, b.note_id from everything_best_notes b
    union all
    select 'recommendations', r.note_id from everything_note_recommendations r where r.moved_at is null and r.removed_at is null
    union all
    select 'removed', r.note_id from everything_note_recommendations r where r.removed_at is not null
  ),
  visible as (
    select s.section, p.id as project_id
      from section_notes s
      join everything_notes n on n.id = s.note_id and n.status <> 'hidden'
      join everything_claims c on c.id = n.claim_id
      join everything_items i on i.id = c.item_id
      left join everything_projects p on p.id = i.project_id
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'recommendations', (select count(*) from visible where section = 'recommendations'),
      'leaderboard', (select count(*) from visible where section = 'leaderboard'),
      'removed', (select count(*) from visible where section = 'removed')),
    'creators', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'name', p.name, 'feed_url', p.feed_url, 'avatar_url', p.avatar_url, 'count', counted.count)
               order by counted.count desc, lower(p.name)), '[]')
        from (select v.project_id, count(*) as count from visible v where v.section = p_section and v.project_id is not null group by v.project_id) counted
        join everything_projects p on p.id = counted.project_id))
  into result;
  return result;
end;
$$;


-- Who may call what. Supabase grants every new function in the public schema
-- to anon and authenticated by default, so every grant is spelled out. The
-- building blocks run only inside the functions above.

revoke all on function
  everything_log_gamma(float8),
  everything_beta_continued_fraction(float8, float8, float8),
  everything_incomplete_beta(float8, float8, float8),
  everything_probability_helpful(int, int, int),
  everything_note_status(float8),
  everything_feed_candidates(everything_feed_scope),
  everything_feed_stream(everything_feed_candidate[], text[], text, jsonb, int),
  everything_note_feed_page(uuid, uuid, text, int, int, int, int, boolean, timestamptz, jsonb, int),
  everything_note_feed_summary(uuid, uuid, int, int, int, int, boolean, timestamptz, timestamptz[]),
  everything_projects_page(text, numeric, text, uuid, int),
  everything_project_items_page(uuid, timestamptz, uuid, int),
  everything_curation_page(text, text, boolean, boolean, timestamptz, float8, uuid, int),
  everything_curation_summary(text)
from public, anon, authenticated;

-- The generated columns call the probability function whenever a note row is
-- written, and a write runs with the writer's rights. So every role that
-- writes notes needs it, and it reads nothing, so anyone may call it.
grant execute on function
  everything_log_gamma(float8),
  everything_beta_continued_fraction(float8, float8, float8),
  everything_incomplete_beta(float8, float8, float8),
  everything_probability_helpful(int, int, int)
to anon, authenticated, service_role;

grant execute on function
  everything_note_feed_page(uuid, uuid, text, int, int, int, int, boolean, timestamptz, jsonb, int),
  everything_note_feed_summary(uuid, uuid, int, int, int, int, boolean, timestamptz, timestamptz[]),
  everything_projects_page(text, numeric, text, uuid, int),
  everything_project_items_page(uuid, timestamptz, uuid, int)
to anon, authenticated, service_role;

grant execute on function
  everything_curation_page(text, text, boolean, boolean, timestamptz, float8, uuid, int),
  everything_curation_summary(text)
to authenticated, service_role;

notify pgrst, 'reload schema';
