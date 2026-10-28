-- 153: the review page filters and sorts by any field (GOO-623).
--
-- Until now the review page had a sidebar of five sections, a fixed set of
-- filters, each a parameter of two functions, and one order: newest first.
-- Jim asked on 2026-10-28 for filters and sorts by every field anyone could
-- want, any number of sort levels, and the marks Nathan needs to post notes
-- on X. So:
--
-- 1. Two marks. "Posted on X" and "We won't post this" are facts about a note,
--    in everything_note_x_marks. The leaderboard's own "Posted on X" column
--    (everything_best_notes.posted_at, migration 138) moves into it, so there
--    is one such mark everywhere. "Few-shot example" marks a draft whose
--    passage and note should later teach the note writer by example, in
--    everything_claude_few_shot_examples. A rewrite of a note gives it a new
--    id, so the rewrite now carries the note's X mark over to the new note.
-- 2. One row of fields per draft (everything_review_field_rows). Its row type
--    everything_review_field_row is also the list of the columns a request
--    may name. Adding a field is one more column there.
-- 3. One page function (everything_review_page) that takes the filters and
--    sorts as JSON. It writes their conditions into its query as it runs,
--    which is called dynamic SQL. Every column name in the request is checked
--    against the row type and quoted, and every value is cast to a number or
--    quoted as text, so the request cannot add SQL of its own. The page pages
--    by a sort key: an array of numbers, first the buckets of every sort
--    level, then the exact values of the bucketed levels, then the time the
--    draft was written. Postgres compares such arrays element by element, so
--    "the rows after the last one shown" is one comparison whatever the sort.
--    everything_review_summary counts the matching drafts and
--    everything_review_facets counts each value of the choice fields.
--
-- This migration only adds, so the website that is live while the pull
-- request waits keeps working. The new functions have names of their own.
-- Migration 154 removes what this one replaces, once the new website is live:
-- the section functions of migrations 143 to 151, the crowd rating helpers
-- whose rules the field row now holds, and the leaderboard's posted_at column.
-- Until then everything_set_x_mark also writes posted_at, so the leaderboard
-- shows the same mark on both websites.

-- 1. The marks.

create table everything_note_x_marks (
  note_id uuid primary key references everything_notes (id) on delete cascade,
  mark text not null check (mark in ('posted', 'wont_post')),
  -- Set when the note was posted through the local posting tool: the Typefully
  -- draft it made, and when Typefully schedules it.
  typefully_draft_id text,
  scheduled_for timestamptz,
  -- Null for the marks moved over from the leaderboard.
  marked_by text check (marked_by in ('jim', 'nathan')),
  marked_at timestamptz not null default now()
);
comment on table everything_note_x_marks is
  'Whether a note was posted on X, or the admins decided not to post it (GOO-623). No row means not posted yet.';

insert into everything_note_x_marks (note_id, mark, marked_at)
select note_id, 'posted', posted_at from everything_best_notes where posted_at is not null;

create table everything_claude_few_shot_examples (
  draft_id uuid primary key references everything_claude_drafts (id) on delete cascade,
  added_by text not null check (added_by in ('jim', 'nathan')),
  added_at timestamptz not null default now()
);
comment on table everything_claude_few_shot_examples is
  'Drafts the admins picked as examples to show the note writer later (GOO-623).';

alter table everything_note_x_marks enable row level security;
alter table everything_claude_few_shot_examples enable row level security;
revoke all on everything_note_x_marks, everything_claude_few_shot_examples from anon, authenticated;
grant all on everything_note_x_marks, everything_claude_few_shot_examples to service_role;
create policy note_x_marks_admin_read on everything_note_x_marks for select to authenticated using (everything_is_admin());
grant select on everything_note_x_marks to authenticated;

-- Sets or clears a note's X mark. A null mark clears it. Until migration 154
-- it also writes the leaderboard's own posted_at, which the live website reads.
create function everything_set_x_mark(p_note uuid, p_mark text, p_typefully_draft_id text default null, p_scheduled_for timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
begin
  update everything_best_notes set posted_at = case when p_mark = 'posted' then coalesce(posted_at, now()) end where note_id = p_note;
  if p_mark is null then
    delete from everything_note_x_marks where note_id = p_note;
    return;
  end if;
  insert into everything_note_x_marks (note_id, mark, typefully_draft_id, scheduled_for, marked_by)
  values (p_note, p_mark, p_typefully_draft_id, p_scheduled_for, v_actor)
  on conflict (note_id) do update
    set mark = excluded.mark, typefully_draft_id = excluded.typefully_draft_id,
        scheduled_for = excluded.scheduled_for, marked_by = excluded.marked_by, marked_at = now();
end;
$$;

-- Marks a draft as a few-shot example, or takes the mark off.
create function everything_claude_set_few_shot(p_draft uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
begin
  if p_on then
    insert into everything_claude_few_shot_examples (draft_id, added_by) values (p_draft, v_actor) on conflict do nothing;
  else
    delete from everything_claude_few_shot_examples where draft_id = p_draft;
  end if;
end;
$$;

-- As in migration 143, except that the note's X mark moves to the new note.
create or replace function everything_claude_rewrite(
  p_draft uuid,
  p_note text,
  p_reason text,
  p_posted_as text default null,
  p_sources jsonb default null,
  p_passage text default null,
  p_context_paragraph text default null,
  p_video_timing jsonb default null,
  p_actor text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
  v_posted_as text;
  v_author uuid;
  v_mark everything_note_x_marks;
  v_note uuid;
begin
  if p_posted_as is not null and p_posted_as not in ('ai', 'me') then
    raise exception 'Post as ai or me';
  end if;
  if p_posted_as = 'me' and auth.uid() is null then
    raise exception 'Only a signed-in admin can post a note as themselves';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'The note is empty';
  end if;
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  update everything_claude_drafts
     set note = p_note,
         outcome = 'note',
         sources = coalesce(p_sources, sources),
         passage = coalesce(p_passage, passage),
         context_paragraph = case when p_passage is null then context_paragraph else p_context_paragraph end,
         video_timing = case when p_passage is null then video_timing else p_video_timing end,
         proposed_note = null,
         proposed_sources = null,
         updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, 'rewritten', d.id, d.item_id, jsonb_build_object(
    'reason', coalesce(p_reason, ''), 'previous_note', d.note, 'previous_sources', d.sources,
    'previous_passage', d.passage, 'note', p_note
  ));
  if d.status <> 'posted' or d.note_id is null then
    return null;
  end if;
  if p_posted_as = 'ai' then
    v_posted_as := 'ai';
  elsif p_posted_as = 'me' then
    v_posted_as := v_actor;
    v_author := auth.uid();
  else
    v_posted_as := d.posted_as;
    select author_id into v_author from everything_notes where id = d.note_id;
  end if;
  select * into v_mark from everything_note_x_marks where note_id = d.note_id;
  perform everything_claude_remove_note(d.note_id);
  v_note := everything_claude_publish(d.id, v_posted_as, v_actor, v_author);
  if v_mark.note_id is not null then
    v_mark.note_id := v_note;
    insert into everything_note_x_marks select v_mark.*;
  end if;
  return v_note;
end;
$$;

-- 2. The fields.

-- Every field of a draft that the review page filters or sorts by. The
-- column names are the field ids of the page's field registry
-- (src/everything-web/src/pages/noteReview/reviewFields.ts).
create type everything_review_field_row as (
  id uuid,
  -- 'posted', 'wont_post' or 'not_posted'.
  on_x text,
  -- The reader's own vote, and Jim's and Nathan's: 'helpful', 'somewhat',
  -- 'not_helpful' or 'none'.
  my_vote text,
  jim_vote text,
  nathan_vote text,
  -- How the crowd rated the note: 'helpful' or 'not_helpful' when its votes
  -- rate it so, 'upvoted' or 'downvoted' when it has only votes of one side,
  -- otherwise 'other' (migration 149).
  rating text,
  p_helpful float8,
  p_impactful float8,
  helpful_votes int,
  somewhat_votes int,
  not_helpful_votes int,
  votes int,
  -- Devices outside the team that were shown the post's notes.
  views bigint,
  creator text,
  creator_name text,
  -- The creator's average views over their posts that anybody saw, and how
  -- many such posts they have.
  creator_views float8,
  creator_posts int,
  written timestamptz,
  published timestamptz,
  -- 'approved' or 'disapproved' by Jim's and Nathan's votes, otherwise by the
  -- crowd's overall rating, otherwise 'not_reviewed'. Null without a note.
  approval text,
  outcome text,
  kind text,
  -- 'on_site', 'not_yet' or 'deleted'. Null without a note.
  on_site text,
  posted_as text,
  skipped boolean,
  leaderboard boolean,
  few_shot boolean,
  -- 'none', 'waiting' for Claude's answer, or 'answered'.
  chat text,
  review_note boolean,
  note_length int,
  sources int
);

-- The field rows of the drafts with these ids, or of every draft when
-- `p_ids` is null, as `p_reviewer` sees them. Every table the fields need is
-- grouped once and joined, so the cost grows with the drafts and not with
-- the drafts times the lookups per draft. The overall rating is the rule of
-- migration 149's everything_claude_crowd_rating, which this replaces: the
-- note's rating state, or else whether it has only upvotes or only
-- downvotes. The author's own automatic vote does not count.
create function everything_review_field_rows(p_reviewer text, p_views everything_item_views, p_ids uuid[] default null)
returns setof everything_review_field_row
language sql stable security definer set search_path = public as $$
  with drafts as (
    select * from everything_claude_drafts where p_ids is null or id = any (p_ids)
  ),
  reviewers as (
    select u.id, a.reviewer
      from auth.users u
      join everything_admins a on a.email = lower(u.email)
     where a.reviewer is not null
  ),
  vote_names (vote, name) as (values (1, 'helpful'), (0, 'somewhat'), (-1, 'not_helpful')),
  votes as (
    select v.note_id,
           min(vn.name) filter (where v.voter_id = auth.uid()) as mine,
           min(vn.name) filter (where r.reviewer = 'jim') as jim,
           min(vn.name) filter (where r.reviewer = 'nathan') as nathan
      from everything_votes v
      join vote_names vn using (vote)
      left join reviewers r on r.id = v.voter_id
     where v.note_id in (select note_id from drafts)
     group by v.note_id
  ),
  item_views as (
    select unnest(p_views.item_ids) as item_id, unnest(p_views.viewers) as viewers
  ),
  creators as (
    select i.project_id, avg(v.viewers)::float8 as views, count(*)::int as posts
      from item_views v
      join everything_items i on i.id = v.item_id
     where v.viewers >= 1
     group by i.project_id
  ),
  last_chat as (
    select distinct on (e.draft_id) e.draft_id, e.actor
      from everything_claude_events e
     where e.type in ('message', 'answer') and e.draft_id in (select id from drafts)
     order by e.draft_id, e.id desc
  )
  select d.id,
         coalesce(x.mark, 'not_posted'),
         coalesce(vt.mine, 'none'),
         coalesce(vt.jim, 'none'),
         coalesce(vt.nathan, 'none'),
         case
           when n.id is null then 'other'
           when n.state = 'helpful' then 'helpful'
           when n.state = 'not_helpful' then 'not_helpful'
           when n.not_helpful_count = 0 and n.upvotes > 0 then 'upvoted'
           when n.not_helpful_count > 0 and n.upvotes = 0 then 'downvoted'
           else 'other'
         end,
         j.p_helpful,
         j.p_impactful,
         coalesce(n.helpful_count, 0),
         coalesce(n.somewhat_helpful_count, 0),
         coalesce(n.not_helpful_count, 0),
         coalesce(n.feed_votes, 0),
         coalesce(iv.viewers, 0),
         p.slug,
         p.name,
         coalesce(c.views, 0),
         coalesce(c.posts, 0),
         d.created_at,
         coalesce(i.published_time, i.published_at::timestamptz),
         case
           when d.status = 'not_a_note' then null
           when d.verdict is not null then d.verdict
           when n.state = 'helpful' then 'approved'
           when n.state = 'not_helpful' then 'disapproved'
           else 'not_reviewed'
         end,
         d.outcome,
         case when d.status <> 'not_a_note' then d.kind end,
         case d.status when 'posted' then 'on_site' when 'posting' then 'not_yet' when 'removed' then 'deleted' end,
         d.posted_as,
         s.draft_id is not null,
         b.note_id is not null,
         f.draft_id is not null,
         case when lc.draft_id is null then 'none' when lc.actor = 'claude' then 'answered' else 'waiting' end,
         coalesce(d.review_note, '') <> '',
         char_length(d.note),
         (select count(distinct src ->> 'url')::int from jsonb_array_elements(d.sources) src)
    from drafts d
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join creators c on c.project_id = i.project_id
    left join item_views iv on iv.item_id = d.item_id
    left join lateral (
      select n.*, everything_note_status(n.p_helpful) as state,
             n.helpful_count - (n.author_id is not null)::int + n.somewhat_helpful_count as upvotes
        from everything_notes n
       where n.id = d.note_id
    ) n on true
    left join votes vt on vt.note_id = d.note_id
    left join everything_note_x_marks x on x.note_id = d.note_id
    left join everything_claude_judgements j on j.draft_id = d.id and j.note = d.note
    left join everything_claude_skips s on s.draft_id = d.id and s.reviewer = p_reviewer
    left join everything_best_notes b on b.note_id = d.note_id
    left join everything_claude_few_shot_examples f on f.draft_id = d.id
    left join last_chat lc on lc.draft_id = d.id;
$$;

-- One draft as the page shows it: its text and history, every field of its
-- field row as `fields`, and on a page, its `sort_key`.
create type everything_review_draft as (
  id uuid,
  item_id uuid,
  passage text,
  claim text,
  kind text,
  outcome text,
  note text,
  reasoning text,
  sources jsonb,
  status text,
  verdict text,
  note_id uuid,
  posted_as text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz,
  context_paragraph text,
  post_url text,
  post_title text,
  creator text,
  creator_slug text,
  proposed_note text,
  proposed_sources jsonb,
  -- The note judge's reasoning for the note's current text, if it has one.
  -- Its two numbers are in `fields`.
  judge_reasoning text,
  -- [{ reviewer, vote }]: Jim's and Nathan's votes on the live note, 1, 0 or -1.
  reviewer_votes jsonb,
  review_note text,
  review_note_by text,
  review_note_at timestamptz,
  -- [{ at, actor, text }], oldest first.
  messages jsonb,
  -- [{ at, note, reason }], oldest first.
  earlier_versions jsonb,
  fields jsonb,
  sort_key float8[]
);

-- The drafts with these ids, in that order, as `p_reviewer` sees them. The
-- functions below are the only callers, and each checks the caller first.
create function everything_review_rows(p_ids uuid[], p_reviewer text, p_views everything_item_views) returns setof everything_review_draft
language sql stable security definer set search_path = public as $$
  select d.id, d.item_id, d.passage, d.claim, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.verdict, d.note_id, d.posted_as, d.reviewed_by, d.reviewed_at, d.created_at, d.context_paragraph,
         i.url, i.title, p.name, p.slug,
         d.proposed_note, d.proposed_sources,
         j.reasoning,
         coalesce((
           select jsonb_agg(jsonb_build_object('reviewer', everything_reviewer_of(v.voter_id), 'vote', v.vote) order by v.updated_at)
             from everything_votes v
            where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null
         ), '[]'::jsonb),
         d.review_note, d.review_note_by, d.review_note_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', '')) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id and e.type in ('message', 'answer')
         ), '[]'::jsonb),
         -- Rewrites imported from the GOO-504 file log name the old text
         -- previousNote.
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', e.at,
                    'note', coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote', e.data ->> 'note', ''),
                    'reason', coalesce(e.data ->> 'reason', e.data ->> 'reply', '')
                  ) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id
              and ((e.type = 'rewritten' and coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote') is not null) or e.type = 'withdrawn')
         ), '[]'::jsonb),
         to_jsonb(f) - 'id',
         null::float8[]
    from everything_claude_drafts d
    join everything_review_field_rows(p_reviewer, p_views, p_ids) f on f.id = d.id
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join everything_claude_judgements j on j.draft_id = d.id and j.note = d.note
   order by array_position(p_ids, d.id);
$$;

-- 3. Requests.

-- A column of the field row as a number, for comparing and sorting: a moment
-- as seconds since 1970, true and false as 1 and 0. Raises for a column the
-- field row does not have, and for a text column.
create function everything_review_number(p_column text) returns text
language plpgsql stable set search_path = public as $$
declare
  v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
   where a.attrelid = 'everything_review_field_row'::regclass and a.attname = p_column and a.attnum > 0 and not a.attisdropped;
  if v_type is null then raise exception 'Unknown field %', p_column; end if;
  return case
    when v_type = 'timestamp with time zone' then format('extract(epoch from f.%I)::float8', p_column)
    when v_type = 'boolean' then format('f.%I::int::float8', p_column)
    when v_type in ('integer', 'bigint', 'double precision', 'numeric') then format('f.%I::float8', p_column)
    else null
  end;
end;
$$;

-- A column of the field row as text, for choices.
create function everything_review_text(p_column text) returns text
language plpgsql stable set search_path = public as $$
begin
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'everything_review_field_row'::regclass and a.attname = p_column and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'Unknown field %', p_column;
  end if;
  return format('f.%I::text', p_column);
end;
$$;

-- The condition of a request's filters, leaving out those on `p_skip_column`:
-- [{ column, min?, max? } | { column, in: [...] }], all of which must hold.
create function everything_review_condition(p_filters jsonb, p_skip_column text default null) returns text
language plpgsql stable set search_path = public as $$
declare
  f jsonb;
  v_number text;
  v_parts text[] := array['true'];
begin
  for f in select t.value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) t loop
    continue when f ->> 'column' = p_skip_column;
    if f ? 'in' then
      v_parts := v_parts || format('%s = any (%L::text[])', everything_review_text(f ->> 'column'), array(select jsonb_array_elements_text(f -> 'in')));
    else
      v_number := everything_review_number(f ->> 'column');
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
create function everything_review_signed(p_value text, p_sort jsonb) returns text
language sql immutable as $$
  select format('coalesce(%s, ''infinity''::float8)', case when coalesce((p_sort ->> 'descending')::boolean, false) then format('-(%s)', p_value) else p_value end)
$$;

-- The sort key of a request's sorts, as an expression for an array of
-- numbers: [{ column, descending, buckets?, order? }]. It sorts in two passes.
-- The first pass takes every level in turn: a choice by its value's position
-- in `order`, worst first, a number with `buckets` by how many of those
-- ascending boundaries it reaches, and any other number by itself. Drafts
-- that tie on all of that form a group, and the second pass orders each group
-- by the exact values of the bucketed levels, again in turn. The time the
-- draft was written, newest first, settles the rest. A descending level is
-- negated in both passes, and a missing value sorts last.
create function everything_review_sort_key(p_sorts jsonb) returns text
language plpgsql stable set search_path = public as $$
declare
  s jsonb;
  v_exact text;
  v_first text[] := '{}';
  v_second text[] := '{}';
begin
  for s in select t.value from jsonb_array_elements(coalesce(p_sorts, '[]'::jsonb)) t loop
    if s ? 'order' then
      v_first := v_first || everything_review_signed(format('array_position(%L::text[], %s)::float8', array(select jsonb_array_elements_text(s -> 'order')), everything_review_text(s ->> 'column')), s);
      continue;
    end if;
    v_exact := everything_review_number(s ->> 'column');
    if v_exact is null then raise exception 'Field % cannot be sorted', s ->> 'column'; end if;
    if s ? 'buckets' then
      v_first := v_first || everything_review_signed(format('case when %1$s is null then null else (select count(*) from unnest(%2$L::float8[]) b where b <= %1$s)::float8 end',
                                                            v_exact, array(select jsonb_array_elements_text(s -> 'buckets'))::float8[]), s);
      v_second := v_second || everything_review_signed(v_exact, s);
    else
      v_first := v_first || everything_review_signed(v_exact, s);
    end if;
  end loop;
  return format('array[%s]::float8[]', array_to_string(v_first || v_second || 'coalesce(-extract(epoch from f.written)::float8, 0)'::text, ', '));
end;
$$;

-- One page of the drafts that pass the request's filters, in its order,
-- starting after the draft with sort key `p_after_key` and id `p_after_id`.
create function everything_review_page(p_request jsonb, p_after_key float8[] default null, p_after_id uuid default null, p_limit int default 20)
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
      everything_review_sort_key(p_request -> 'sorts'), everything_review_condition(p_request -> 'filters'))
    into v_ids, v_keys
    using v_reviewer, v_views, p_after_key, p_after_id, least(greatest(p_limit, 1), max_page_size);
  for v_draft in select * from everything_review_rows(coalesce(v_ids, '{}'), v_reviewer, v_views) loop
    v_draft.sort_key := array(select jsonb_array_elements_text(v_keys -> (array_position(v_ids, v_draft.id) - 1)))::float8[];
    return next v_draft;
  end loop;
end;
$$;

-- A few drafts by id, so the page can refresh the ones a reviewer changed or
-- whose chat waits for Claude's answer, without reloading every page.
create function everything_review_drafts(p_ids uuid[]) returns setof everything_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_ids constant int := 50;
  v_reviewer text := everything_claude_actor(null);
begin
  if cardinality(p_ids) > max_ids then raise exception 'Ask for at most % drafts', max_ids; end if;
  return query select * from everything_review_rows(p_ids, v_reviewer, everything_item_views());
end;
$$;

-- Who is reviewing, who writes the notes, how many drafts pass the request's
-- filters, and when the newest of them was written. The page polls it to
-- offer drafts that arrived after it loaded.
create function everything_review_summary(p_request jsonb)
returns table (reviewer text, writer text, matching bigint, newest timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_matching bigint;
  v_newest timestamptz;
begin
  execute format('select count(*), max(f.written) from everything_review_field_rows($1, $2) f where %s', everything_review_condition(p_request -> 'filters'))
    into v_matching, v_newest
    using v_reviewer, everything_item_views();
  return query select v_reviewer, s.writer, v_matching, v_newest from everything_claude_settings s;
end;
$$;

-- How many drafts each value of the given choice fields holds:
-- [{ column, label_column? }]. Each field's count leaves out its own filter,
-- so the Filter menu shows what picking another value would give. A value's
-- label comes from `label_column` when the field has one.
create function everything_review_facets(p_request jsonb, p_facets jsonb)
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
      everything_review_text(facet ->> 'column'),
      case when facet ? 'label_column' then everything_review_text(facet ->> 'label_column') else 'null' end,
      everything_review_condition(p_request -> 'filters', facet ->> 'column'));
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

-- 4. Who may call what.
revoke all on function
  everything_set_x_mark(uuid, text, text, timestamptz),
  everything_claude_set_few_shot(uuid, boolean),
  everything_review_field_rows(text, everything_item_views, uuid[]),
  everything_review_rows(uuid[], text, everything_item_views),
  everything_review_number(text),
  everything_review_text(text),
  everything_review_condition(jsonb, text),
  everything_review_signed(text, jsonb),
  everything_review_sort_key(jsonb),
  everything_review_page(jsonb, float8[], uuid, int),
  everything_review_drafts(uuid[]),
  everything_review_summary(jsonb),
  everything_review_facets(jsonb, jsonb)
from public, anon, authenticated;

grant execute on function
  everything_set_x_mark(uuid, text, text, timestamptz),
  everything_claude_set_few_shot(uuid, boolean),
  everything_review_page(jsonb, float8[], uuid, int),
  everything_review_drafts(uuid[]),
  everything_review_summary(jsonb),
  everything_review_facets(jsonb, jsonb)
to authenticated, service_role;
