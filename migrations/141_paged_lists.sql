-- 141: real page-by-page loading for every growing list on commonnotes.net
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
-- 1. The chance that a note ends up rated helpful.
-- 2. The notes feed: its sort values stored and indexed on every note, one
--    page, and a summary with the counts the page shows.
-- 3. The creators overview, and one creator's posts.
-- 4. The admins' best-notes curation: one page, and a summary.
-- 5. The admin dashboard's two tables.


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
-- from a backup runs with an empty search path.

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
--
-- Every value the feed sorts by is stored on the note's own row, and an index
-- holds the notes in each order. So a page reads its notes straight from an
-- index, and it costs about the same however many notes the site has. The
-- values come from three tables: the note's votes, its claim's clip timestamp
-- and quote, and its post's date and project. An index can only cover the
-- columns of one table, so triggers copy the values onto the note whenever
-- any of them changes. The tables stay the source of truth, and the copies
-- are derived from them, as the vote counts on a note are derived from its
-- votes.

-- 2a. The values the feed sorts by, stored on every note.
--
-- * p_helpful: the chance that the note ends up rated helpful. The author's
--   own Helpful vote is taken out, as noteTally does, because a trigger casts
--   it automatically and it tells us nothing.
-- * p_helpful_after_helpful: where that chance would land after one more
--   Helpful vote, which is how the feed ranks the notes that need ratings.
-- * feed_item_id and feed_project_id: the note's post and project, so a
--   creator's feed can be read without joining the claim and the post.
-- * feed_band: the note's rating state, or 'stale' when the source text has
--   changed since we quoted it.
-- * feed_votes: all votes on the note.
-- * One sort key per order, negated where the order is descending, so every
--   order is ascending and one comparison finds the notes after a bookmark.
--   feed_helpful_key is the chance, then more votes first, then the newest
--   post. feed_needs_key is how far one more Helpful vote would push the note,
--   then the oldest note first, because that is where a rating settles the
--   most. feed_best_key is the chance alone. feed_recent_key is the newest
--   note first. Each ends in the post's date, newest first.
-- * feed_content_key: the note's place in its post, which breaks every tie
--   after the post's id: the clip timestamp, then the age of the improvement
--   chain the note belongs to, then originals before improvements, then the
--   older note first. Every order ends with the post's id, this key and the
--   note's id, so the notes of one post stay together on a tie and every
--   position is unique.
alter table everything_notes
  add column p_helpful float8,
  add column p_helpful_after_helpful float8,
  add column feed_item_id uuid,
  add column feed_project_id uuid,
  add column feed_band text,
  add column feed_votes int,
  add column feed_helpful_key float8[],
  add column feed_needs_key float8[],
  add column feed_best_key float8[],
  add column feed_recent_key float8[],
  add column feed_content_key float8[];

comment on column everything_notes.p_helpful is
  'The chance that the note ends up rated helpful, from its votes without the author''s own (migration 141). Kept by a trigger.';
comment on column everything_notes.p_helpful_after_helpful is
  'Where p_helpful would land after one more Helpful vote (migration 141). Kept by a trigger.';
comment on column everything_notes.feed_band is
  'helpful, needs_ratings, not_helpful, or stale when the source text changed (migration 141). Kept by a trigger, like every feed_* column: copies the website''s feed sorts and filters by.';

-- The note with every feed value worked out from its votes, its claim and its
-- post. Both the trigger below and the drift check in the verify file use it.
-- A note whose claim or post cannot be found keeps the values it has.
create function everything_note_feed_fields(n everything_notes) returns everything_notes
language plpgsql stable security definer set search_path = public as $$
declare
  helpful int := greatest(n.helpful_count - (n.author_id is not null)::int, 0);
  claim everything_claims;
  item everything_items;
  item_epoch float8;
  created_epoch float8 := extract(epoch from n.created_at);
  chain_epoch float8;
begin
  n.p_helpful := everything_probability_helpful(helpful, n.somewhat_helpful_count, n.not_helpful_count);
  n.p_helpful_after_helpful := everything_probability_helpful(helpful + 1, n.somewhat_helpful_count, n.not_helpful_count);
  n.feed_votes := n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count;
  select * into claim from everything_claims c where c.id = n.claim_id;
  select * into item from everything_items i where i.id = claim.item_id;
  if item.id is null then return n; end if;
  -- An improvement belongs to the chain of the note it improves, which
  -- already carries the chain's age. The browser's walk ended at a hidden
  -- note, so a hidden note passes on no chain here either.
  select p.feed_content_key[2] into chain_epoch
    from everything_notes p
   where p.id = n.improved_from_note_id and p.status <> 'hidden';
  -- A post's publication date has no time of day, so it counts from midnight
  -- UTC, whatever the session's time zone.
  item_epoch := extract(epoch from coalesce(item.published_at::timestamp at time zone 'UTC', item.created_at));
  n.feed_item_id := item.id;
  n.feed_project_id := item.project_id;
  n.feed_band := case when claim.updated_quote is not null then 'stale' else everything_note_status(n.p_helpful) end;
  n.feed_helpful_key := array[-n.p_helpful, -n.feed_votes, -item_epoch];
  n.feed_needs_key := array[-n.p_helpful_after_helpful, created_epoch, -item_epoch];
  n.feed_best_key := array[-n.p_helpful, -item_epoch];
  n.feed_recent_key := array[-created_epoch, -item_epoch];
  n.feed_content_key := array[coalesce(claim.start_seconds, 0), coalesce(chain_epoch, created_epoch),
                              (n.improved_from_note_id is not null)::int, created_epoch];
  return n;
end;
$$;

create function everything_notes_set_feed_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  return everything_note_feed_fields(new);
end;
$$;

-- Every write to a note works its values out again. A vote changes the note's
-- counts through the vote counter trigger, so it lands here too.
create trigger everything_notes_feed_fields
  before insert or update on everything_notes
  for each row execute function everything_notes_set_feed_fields();

-- A change to a claim's clip timestamp or quote, or to a post's date or
-- project, rewrites the notes on it, which runs the trigger above.
create function everything_claims_refresh_note_feed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update everything_notes set claim_id = claim_id where claim_id = new.id;
  return null;
end;
$$;

create trigger everything_claims_refresh_note_feed
  after update of start_seconds, updated_quote, item_id on everything_claims
  for each row
  when (old.start_seconds is distinct from new.start_seconds
        or old.updated_quote is distinct from new.updated_quote
        or old.item_id is distinct from new.item_id)
  execute function everything_claims_refresh_note_feed();

create function everything_items_refresh_note_feed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update everything_notes n set claim_id = n.claim_id
    from everything_claims c
   where c.item_id = new.id and n.claim_id = c.id;
  return null;
end;
$$;

create trigger everything_items_refresh_note_feed
  after update of published_at, created_at, project_id on everything_items
  for each row
  when (old.published_at is distinct from new.published_at
        or old.created_at is distinct from new.created_at
        or old.project_id is distinct from new.project_id)
  execute function everything_items_refresh_note_feed();

-- Fills in every existing note. An improvement reads the chain's age from the
-- note it improves, which the first pass may not have reached yet. Each further
-- pass settles one more step of a chain. On 2026-10-25 no chain was longer
-- than one step, so five passes leave room.
update everything_notes set claim_id = claim_id;
do $$
begin
  for pass in 1..5 loop
    update everything_notes set claim_id = claim_id where improved_from_note_id is not null;
  end loop;
end $$;

-- One index per stream of the feed, in the stream's order. The helpful notes
-- of the mixed order read the Most helpful index, where they come first.
create index everything_notes_feed_most_helpful on everything_notes (feed_helpful_key, feed_item_id, feed_content_key, id) where status <> 'hidden';
create index everything_notes_feed_needs_ratings on everything_notes (feed_band, feed_needs_key, feed_item_id, feed_content_key, id) where status <> 'hidden';
create index everything_notes_feed_best on everything_notes (feed_band, feed_best_key, feed_item_id, feed_content_key, id) where status <> 'hidden';
create index everything_notes_feed_recent on everything_notes (feed_recent_key, feed_item_id, feed_content_key, id) where status <> 'hidden';
-- A creator's feed and the counts beside every feed read this one, without
-- touching the note rows themselves.
create index everything_notes_feed_scope on everything_notes (feed_project_id, feed_item_id)
  include (id, feed_band, created_at, feed_votes, helpful_count, not_helpful_count) where status <> 'hidden';

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

-- How many devices outside the team were shown each post's notes (migration
-- 128), as two arrays of the same length. The extension writes the post's id
-- into a view event, so it is read as text, and only a well-formed id counts.
create type everything_item_views as (item_ids uuid[], viewers bigint[]);

create function everything_item_views() returns everything_item_views
language sql stable security definer set search_path = public as $$
  select row(coalesce(array_agg(v.item_id::uuid), '{}'), coalesce(array_agg(v.viewers), '{}'))::everything_item_views
    from everything_item_note_viewers() v
   where v.item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- One stream of the feed: the notes of one band, or of every band when
-- `p_band` is null, in one sort order, starting right after the position
-- `p_after`. The query reads the notes in the order of the stream's index and
-- stops after `p_limit` notes that pass the filters. Only the conditions that
-- apply are written into it, so Postgres plans each request for what it
-- actually asks.
create function everything_feed_stream(
  p_scope everything_feed_scope,
  p_views everything_item_views,
  p_band text,
  p_key text,
  p_after jsonb,
  p_limit int
) returns table (id uuid, item_id uuid, key float8[], content float8[], views bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  key_column text := case p_key
    when 'helpful' then 'feed_helpful_key'
    when 'needs_ratings' then 'feed_needs_key'
    when 'best' then 'feed_best_key'
    when 'recent' then 'feed_recent_key'
  end;
  views_of constant text := 'coalesce(($2).viewers[array_position(($2).item_ids, n.feed_item_id)], 0)';
  conditions text[] := array['n.status <> ''hidden'''];
begin
  if key_column is null then raise exception 'Unknown sort key %', p_key; end if;
  if p_band is not null then conditions := conditions || 'n.feed_band = $3'::text; end if;
  if p_scope.project_id is not null then conditions := conditions || 'n.feed_project_id = ($1).project_id'::text; end if;
  if p_scope.item_id is not null then conditions := conditions || 'n.feed_item_id = ($1).item_id'::text; end if;
  if coalesce(p_scope.min_views, 0) > 0 then conditions := conditions || (views_of || ' >= ($1).min_views'); end if;
  if coalesce(p_scope.min_votes, 0) > 0 then conditions := conditions || 'n.feed_votes >= ($1).min_votes'::text; end if;
  if coalesce(p_scope.min_helpful, 0) > 0 then conditions := conditions || 'n.helpful_count >= ($1).min_helpful'::text; end if;
  if coalesce(p_scope.min_not_helpful, 0) > 0 then conditions := conditions || 'n.not_helpful_count >= ($1).min_not_helpful'::text; end if;
  -- A note the reader wrote counts as voted on, because posting a note casts a
  -- Helpful vote on it.
  if p_scope.unvoted_only then
    conditions := conditions || 'not exists (select 1 from everything_votes ev where ev.note_id = n.id and ev.voter_id = auth.uid() and ev.created_at < coalesce(($1).voted_before, now()))'::text;
  end if;
  if p_after is not null and p_after <> 'null'::jsonb then
    conditions := conditions || format(
      '(n.%I, n.feed_item_id, n.feed_content_key, n.id) > ('
      'array(select jsonb_array_elements_text($4 -> ''key'')::float8), ($4 ->> ''item_id'')::uuid, '
      'array(select jsonb_array_elements_text($4 -> ''content'')::float8), ($4 ->> ''id'')::uuid)', key_column);
  end if;
  return query execute format(
    'select n.id, n.feed_item_id, n.%1$I, n.feed_content_key, %2$s::bigint from everything_notes n where %3$s '
    'order by n.%1$I, n.feed_item_id, n.feed_content_key, n.id limit $5',
    key_column, views_of, array_to_string(conditions, ' and '))
  using p_scope, p_views, p_band, p_after, p_limit;
end;
$$;

-- One page of the feed, as {"notes": [{"id", "band", "views"}], "next": <position>}.
-- `band` names the band of the mixed order a note belongs to: main, unhelpful
-- or stale. The other two orders put every note in the band 'all'. `views`
-- counts the devices outside the team that were shown the post's notes. `next` is
-- what the website passes as p_after to get the following page, and it is null
-- after the last page. The website treats it as an opaque bookmark. The
-- bookmark holds sort values as numbers, so the function writes them with
-- every digit, whatever the caller's session asks for, and a value read back
-- is exactly the value stored.
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
language plpgsql stable security definer set search_path = public set extra_float_digits = 3 as $$
declare
  max_page_size constant int := 100;
  leading_helpful_notes constant int := 3;
  scope everything_feed_scope := row(p_project_id, p_item_id, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before);
  item_views everything_item_views := everything_item_views();
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
            from everything_feed_stream(scope, item_views, 'helpful', 'helpful', helpful_after, remaining) s
        ),
        needs as (
          select s.*, needs_taken - 1 + row_number() over (order by s.key, s.item_id, s.content, s.id) as taken_index
            from everything_feed_stream(scope, item_views, 'needs_ratings', 'needs_ratings', needs_after, remaining) s
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
          scope,
          item_views,
          case band when 'unhelpful' then 'not_helpful' when 'stale' then 'stale' end,
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
-- the filter controls. A count has to look at every note in the scope, so all
-- of them are counted in one pass over the narrow scope index, never the note
-- rows. As in the stream, only the conditions that apply are written into the
-- query, which lets Postgres use that index.
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
language plpgsql stable security definer set search_path = public as $$
declare
  in_scope text[] := array['n.status <> ''hidden'''];
  passes text[] := array['true'];
  since_counts text[] := '{}';
  result jsonb;
begin
  if p_project_id is not null then in_scope := in_scope || 'n.feed_project_id = $1'::text; end if;
  if p_item_id is not null then in_scope := in_scope || 'n.feed_item_id = $2'::text; end if;
  if p_min_views > 0 then passes := passes || 'coalesce(iv.viewers, 0) >= $3'::text; end if;
  if p_min_votes > 0 then passes := passes || 'n.feed_votes >= $4'::text; end if;
  if p_min_helpful > 0 then passes := passes || 'n.helpful_count >= $5'::text; end if;
  if p_min_not_helpful > 0 then passes := passes || 'n.not_helpful_count >= $6'::text; end if;
  -- A note the reader wrote counts as voted on, because posting a note casts a
  -- Helpful vote on it.
  if p_unvoted_only then passes := passes || 'mine.note_id is null'::text; end if;
  for i in 1 .. coalesce(cardinality(p_since), 0) loop
    since_counts := since_counts || format('count(*) filter (where passes and created_at >= ($8)[%s])', i);
  end loop;
  execute format($query$
    with item_views as (
      select unnest(v.item_ids) as item_id, unnest(v.viewers) as viewers from everything_item_views() v
    ),
    mine as (
      select ev.note_id from everything_votes ev where ev.voter_id = auth.uid() and ev.created_at < coalesce($7, now())
    ),
    scoped as (
      select n.created_at, n.feed_band, n.feed_votes, n.helpful_count, n.not_helpful_count,
             coalesce(iv.viewers, 0) as views, (%1$s) as passes
        from everything_notes n
        left join item_views iv on iv.item_id = n.feed_item_id
        left join mine on mine.note_id = n.id
       where %2$s
    )
    select jsonb_build_object(
      'matching', count(*) filter (where passes),
      'bands', jsonb_build_object(
        'main', count(*) filter (where passes and feed_band in ('helpful', 'needs_ratings')),
        'unhelpful', count(*) filter (where passes and feed_band = 'not_helpful'),
        'stale', count(*) filter (where passes and feed_band = 'stale')),
      'since', jsonb_build_array(%3$s),
      'largest', jsonb_build_object(
        'views', coalesce(max(views), 0),
        'votes', coalesce(max(feed_votes), 0),
        'helpful', coalesce(max(helpful_count), 0),
        'not_helpful', coalesce(max(not_helpful_count), 0)))
    from scoped
  $query$, array_to_string(passes, ' and '), array_to_string(in_scope, ' and '), array_to_string(since_counts, ', '))
  into result
  using p_project_id, p_item_id, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_voted_before, p_since;
  return result;
end;
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


-- 5. The admin dashboard's two tables (on the website since 2026-10-23).

-- One page of the walk's ranking of creators, in the walk's order: creators
-- holding priority first, then the highest score, then the most different
-- readers, then the feed address, as byWalkOrder in
-- src/everything-core/readers.ts orders them. The score counts the imagined
-- posts as creatorScore does. The ranking needs every creator's visit numbers
-- before it can be sorted, so each page scores all of them. That is about a
-- hundred creators read from a view refreshed once a day (migration 135).
-- The page starts after the creator `p_after_feed_url` names. Their place is
-- looked up here, from the same scores, so no rounded number travels through
-- the browser. A creator who has left the ranking since ends the list.
create function everything_creator_ranking_page(
  last_posts int, min_score float8, min_posts int, unread_posts float8, average_posts float8,
  p_after_feed_url text default null,
  p_limit int default 25
) returns table (
  feed_url text,
  project_slug text,
  project_name text,
  priority_until timestamptz,
  visitors_per_post float8,
  score_posts bigint,
  people bigint,
  delay_posts bigint,
  median_delay_hours float8,
  vote_posts bigint,
  vote_visitors bigint,
  extension_voters bigint,
  average_readers_per_post float8,
  walk_score float8
)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select r.*,
           (coalesce(r.visitors_per_post, 0) * coalesce(r.score_posts, 0) + average_posts * coalesce(r.average_readers_per_post, 0))
             / (coalesce(r.score_posts, 0) + average_posts + unread_posts) as walk_score
      from everything_creator_ranking(last_posts, min_score, min_posts, unread_posts, average_posts) r
  )
  select k.* from ranked k
   where p_after_feed_url is null
      or (k.priority_until is null, -k.walk_score, -coalesce(k.people, 0), k.feed_url)
         > (select a.priority_until is null, -a.walk_score, -coalesce(a.people, 0), a.feed_url from ranked a where a.feed_url = p_after_feed_url)
   order by k.priority_until is null, k.walk_score desc, coalesce(k.people, 0) desc, k.feed_url
   limit least(greatest(p_limit, 1), 100);
$$;

-- One page of the posts the pipeline finished most recently, newest first,
-- starting after the post the page before ended on. It replaces the version of
-- migration 123, which returned at most a fixed number of posts in one go.
drop function everything_recent_posts(int, int);

create function everything_recent_posts(
  last_posts int,
  p_after_processed_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 25
) returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  author_visitors_per_post float8,
  claims_extracted bigint,
  claims_checked bigint,
  notes bigint
)
language sql stable security definer set search_path = public as $$
  with recent as (
    select i.id, i.title, i.url, i.project_id, i.checked_scope, i.published_at, i.processed_at
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
      and (p_after_id is null or (i.processed_at, i.id) < (p_after_processed_at, p_after_id))
    order by i.processed_at desc, i.id desc
    limit least(greatest(p_limit, 1), 100)
  ),
  author_score as (
    select p.id as project_id, s.visitors_per_post
    from everything_projects p
    cross join lateral everything_creator_visit_score(lower(rtrim(p.feed_url, '/')), last_posts) s
    where p.id in (select recent.project_id from recent)
      and p.feed_url is not null
  ),
  claim_counts as (
    select c.item_id,
           count(*) as extracted,
           count(*) filter (where c.status in ('note', 'no_note', 'error')) as checked
    from everything_claims c
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
    group by c.item_id
  ),
  note_counts as (
    select c.item_id, count(*) as notes
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
      and n.author_id is null
      and n.status <> 'hidden'
    group by c.item_id
  )
  select
    r.id, r.title, r.url, p.name, r.checked_scope, r.published_at, r.processed_at,
    s.visitors_per_post,
    coalesce(cc.extracted, 0), coalesce(cc.checked, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join author_score s on s.project_id = r.project_id
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc, r.id desc
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
  everything_note_feed_fields(everything_notes),
  everything_notes_set_feed_fields(),
  everything_claims_refresh_note_feed(),
  everything_items_refresh_note_feed(),
  everything_item_views(),
  everything_feed_stream(everything_feed_scope, everything_item_views, text, text, jsonb, int),
  everything_note_feed_page(uuid, uuid, text, int, int, int, int, boolean, timestamptz, jsonb, int),
  everything_note_feed_summary(uuid, uuid, int, int, int, int, boolean, timestamptz, timestamptz[]),
  everything_projects_page(text, numeric, text, uuid, int),
  everything_project_items_page(uuid, timestamptz, uuid, int),
  everything_curation_page(text, text, boolean, boolean, timestamptz, float8, uuid, int),
  everything_curation_summary(text),
  everything_creator_ranking_page(int, float8, int, float8, float8, text, int),
  everything_recent_posts(int, timestamptz, uuid, int)
from public, anon, authenticated;

-- The math functions read nothing, so anyone may call them.
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

-- The dashboard's functions return only aggregates, and like the functions
-- they page, anyone with the website's key may call them.
grant execute on function
  everything_creator_ranking_page(int, float8, int, float8, float8, text, int),
  everything_recent_posts(int, timestamptz, uuid, int)
to anon, authenticated, service_role;

grant execute on function
  everything_curation_page(text, text, boolean, boolean, timestamptz, float8, uuid, int),
  everything_curation_summary(text)
to authenticated, service_role;

notify pgrst, 'reload schema';
