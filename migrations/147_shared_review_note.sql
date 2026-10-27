-- 147: one shared review note per draft, and every reviewed note in its
-- section (GOO-563).
--
-- 1. Jim and Nathan keep one note per draft about why it is good or bad. It
--    replaces each reviewer's own explanation of their vote. Both of them see
--    and edit the same text. The explanations and old rejection reasons given
--    so far become each draft's first note, oldest first.
-- 2. Approved now holds every note with a Helpful or Somewhat helpful vote of
--    Jim or Nathan, and Disapproved every note with a Not helpful vote of
--    either. A note they disagree on shows in both. The verdict, from the
--    last vote, still decides the card's label.
-- 3. Four notes Nathan rejected on 2026-10-21 were never taken off the site,
--    because Jim asked for them to stay up. Migration 143 marked them
--    'removed'. They are on the site, so they are 'posted' again; they stay
--    disapproved.

-- 1. The shared note.

alter table everything_claude_drafts
  add column review_note text,
  add column review_note_by text check (review_note_by in ('jim', 'nathan')),
  add column review_note_at timestamptz;

comment on column everything_claude_drafts.review_note is
  'Jim''s and Nathan''s shared note on why the note is good or bad. Either of them edits it on the review page; every change is logged as a review_note event.';

update everything_claude_drafts d
   set review_note = n.text, review_note_by = n.actor, review_note_at = n.at
  from (
    select e.draft_id,
           string_agg(coalesce(e.data ->> 'text', e.data ->> 'reason'), E'\n\n' order by e.id) as text,
           (array_agg(e.actor order by e.id desc) filter (where e.actor in ('jim', 'nathan')))[1] as actor,
           max(e.at) as at
      from everything_claude_events e
     where e.draft_id is not null
       and ((e.type = 'rejected' and coalesce(e.data ->> 'reason', '') <> '') or e.type = 'explained')
     group by e.draft_id
  ) n
 where n.draft_id = d.id;

drop function everything_claude_explain(uuid, text);

-- Sets the shared note. An empty text clears it.
create function everything_claude_set_review_note(p_draft uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
  d everything_claude_drafts;
  v_text text := nullif(trim(p_text), '');
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  update everything_claude_drafts
     set review_note = v_text, review_note_by = v_actor, review_note_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'review_note', d.id, d.item_id, d.note_id, jsonb_build_object('text', v_text, 'previous', d.review_note, 'note', d.note));
end;
$$;

-- 2. Every reviewed note in its section.

-- Whether Jim or Nathan cast a vote of this sign on the note: 1 for Helpful
-- or Somewhat helpful, -1 for Not helpful.
create function everything_claude_has_reviewer_vote(p_note uuid, p_sign int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from everything_votes v
     where v.note_id = p_note
       and everything_reviewer_of(v.voter_id) is not null
       and (case when v.vote >= 0 then 1 else -1 end) = p_sign
  )
$$;

create or replace function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status in ('posted', 'posting', 'awaiting_approval') and d.verdict is null and not skipped
    when 'approved' then d.verdict = 'approved' or everything_claude_has_reviewer_vote(d.note_id, 1)
    when 'disapproved' then d.verdict = 'disapproved' or everything_claude_has_reviewer_vote(d.note_id, -1)
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'posting', 'awaiting_approval')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

-- 3. The rejected notes that stayed on the site.
update everything_claude_drafts d
   set status = 'posted'
 where d.status = 'removed'
   and exists (select 1 from everything_notes n where n.id = d.note_id);

-- 4. What the page reads.

drop function everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int);
drop function everything_claude_review_drafts(uuid[]);
drop function everything_claude_review_rows(uuid[], text, everything_item_views);
drop type everything_claude_review_draft;

-- One draft as the page shows it. Since migration 147 it carries the shared
-- review note instead of each reviewer's explanations.
create type everything_claude_review_draft as (
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
  -- How many devices outside the team were shown the post's notes.
  views bigint,
  proposed_note text,
  proposed_sources jsonb,
  -- The note judge's answer for the note's current text, if it has one.
  judge_p_helpful float8,
  judge_p_impactful float8,
  judge_reasoning text,
  on_leaderboard boolean,
  -- [{ reviewer, vote }]: Jim's and Nathan's votes on the live note, 1, 0 or -1.
  reviewer_votes jsonb,
  -- Whether the reviewer reading the page skipped the draft.
  skipped boolean,
  review_note text,
  review_note_by text,
  review_note_at timestamptz,
  -- [{ at, actor, text }], oldest first.
  messages jsonb,
  -- [{ at, note, reason }], oldest first.
  earlier_versions jsonb
);

-- The drafts with these ids, newest first, as `p_reviewer` sees them, with
-- the views the caller worked out once. The two functions below are the only
-- callers, and each checks the caller first.
create function everything_claude_review_rows(p_ids uuid[], p_reviewer text, p_views everything_item_views) returns setof everything_claude_review_draft
language sql stable security definer set search_path = public as $$
  select d.id, d.item_id, d.passage, d.claim, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.verdict, d.note_id, d.posted_as, d.reviewed_by, d.reviewed_at, d.created_at, d.context_paragraph,
         i.url, i.title, p.name, p.slug,
         everything_claude_draft_views(d, p_views),
         d.proposed_note, d.proposed_sources,
         j.p_helpful, j.p_impactful, j.reasoning,
         exists (select 1 from everything_best_notes b where b.note_id = d.note_id),
         coalesce((
           select jsonb_agg(jsonb_build_object('reviewer', everything_reviewer_of(v.voter_id), 'vote', v.vote) order by v.updated_at)
             from everything_votes v
            where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null
         ), '[]'::jsonb),
         exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer),
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
         ), '[]'::jsonb)
    from everything_claude_drafts d
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join everything_claude_judgements j on j.draft_id = d.id and j.note = d.note
   where d.id = any (p_ids)
   order by d.created_at desc, d.id desc;
$$;

-- One page of a sidebar section under the filters, newest first.
create function everything_claude_review_page(
  p_section text,
  p_ratings text[] default null,
  p_min_views int default 0,
  p_min_votes int default 0,
  p_min_helpful int default 0,
  p_min_not_helpful int default 0,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null,
  p_reviewed_by text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 50;
  v_reviewer text := everything_claude_actor(null);
  v_views everything_item_views := everything_item_views();
  v_ids uuid[];
begin
  if p_section not in ('unreviewed', 'approved', 'disapproved', 'no_note', 'skipped') then
    raise exception 'Unknown section %', p_section;
  end if;
  -- The keyset: rows strictly after the last row of the previous page in the
  -- order (created_at desc, id desc).
  select array_agg(d.id) into v_ids
    from (
      select d.id
        from everything_claude_drafts d
       where everything_claude_in_section(d, p_section, v_reviewer)
         and everything_claude_draft_matches(d, v_views, p_ratings, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before)
         and (p_reviewed_by is null or d.reviewed_by = p_reviewed_by)
         and (p_before_created_at is null or (d.created_at, d.id) < (p_before_created_at, p_before_id))
       order by d.created_at desc, d.id desc
       limit least(greatest(p_limit, 1), max_page_size)
    ) d;
  return query select * from everything_claude_review_rows(coalesce(v_ids, '{}'), v_reviewer, v_views);
end;
$$;

-- A few drafts by id, so the page can refresh the ones whose chat waits for
-- Claude's answer without reloading every page.
create function everything_claude_review_drafts(p_ids uuid[]) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_ids constant int := 50;
  v_reviewer text := everything_claude_actor(null);
begin
  if cardinality(p_ids) > max_ids then raise exception 'Ask for at most % drafts', max_ids; end if;
  return query select * from everything_claude_review_rows(p_ids, v_reviewer, everything_item_views());
end;
$$;

-- 5. Who may call what.
revoke all on function
  everything_claude_set_review_note(uuid, text),
  everything_claude_has_reviewer_vote(uuid, int),
  everything_claude_review_rows(uuid[], text, everything_item_views),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
from public, anon, authenticated;

grant execute on function
  everything_claude_set_review_note(uuid, text),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
to authenticated, service_role;
