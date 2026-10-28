-- 145: the review page without "Waiting for approval", and with whose vote
-- decided (GOO-563).
--
-- Jim dropped the approval step on 2026-10-27: every note Claude writes goes
-- up at once. This migration takes it out of the review page: the "Waiting
-- for approval" section and the vote on a waiting note are gone. A draft is
-- still saved before its note is posted, so a failed post leaves it visible.
-- That short state becomes 'posting' and shows under Not reviewed. Until the
-- note writer runs the new code, it still saves drafts as
-- 'awaiting_approval' for that moment, so both names are allowed here.
-- Migration 152 removes the old name and the setting once the new code runs.
--
-- The page also gets a filter by the reviewer whose vote decided, each card
-- carries Jim's and Nathan's votes, and an explanation remembers the vote it
-- explains.

-- 1. No approval step on the page.

alter table everything_claude_drafts drop constraint everything_claude_drafts_status_check;
alter table everything_claude_drafts add constraint everything_claude_drafts_status_check
  check (status in ('posting', 'awaiting_approval', 'posted', 'removed', 'not_a_note'));

drop function everything_claude_vote_waiting(uuid, int, text);

-- Deletes a Claude note from the site, or a draft whose note never made it
-- up. Either way the note counts as disapproved.
create or replace function everything_claude_delete_note(p_draft uuid, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.status not in ('posted', 'posting', 'awaiting_approval') then
    raise exception 'Only a posted note can be deleted';
  end if;
  if d.note_id is not null then
    perform everything_claude_remove_note(d.note_id);
  end if;
  update everything_claude_drafts
     set status = 'removed', note_id = null, verdict = 'disapproved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'deleted', d.id, d.item_id, d.note_id, jsonb_build_object('note', d.note));
end;
$$;

-- 2. An explanation remembers the vote it explains.
create or replace function everything_claude_explain(p_draft uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
  d everything_claude_drafts;
  v_vote int;
begin
  if coalesce(trim(p_text), '') = '' then raise exception 'The explanation is empty'; end if;
  select * into d from everything_claude_drafts where id = p_draft;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  select vote into v_vote from everything_votes where note_id = d.note_id and voter_id = auth.uid();
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'explained', d.id, d.item_id, d.note_id, jsonb_build_object('text', p_text, 'note', d.note, 'vote', v_vote));
  if d.note_id is not null then
    update everything_votes set reasoning = p_text where note_id = d.note_id and voter_id = auth.uid();
  end if;
end;
$$;

-- 3. The sections and what the page reads.

drop function everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz);
drop function everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, timestamptz, uuid, int);
drop function everything_claude_review_drafts(uuid[]);
drop function everything_claude_review_rows(uuid[], text, everything_item_views);
drop type everything_claude_review_draft;

-- Whether a draft belongs to a section of the sidebar for this reviewer.
create or replace function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status in ('posted', 'posting', 'awaiting_approval') and d.verdict is null and not skipped
    when 'approved' then d.verdict = 'approved'
    when 'disapproved' then d.verdict = 'disapproved'
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'posting', 'awaiting_approval')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

-- The page's header: who is reviewing, who writes the notes, how many drafts
-- each section holds under the filters, and the largest view and vote counts
-- of any note, where the filter sliders end. `p_reviewed_by` keeps only the
-- drafts whose deciding vote is that reviewer's.
create function everything_claude_review_summary(
  p_ratings text[] default null,
  p_min_views int default 0,
  p_min_votes int default 0,
  p_min_helpful int default 0,
  p_min_not_helpful int default 0,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null,
  p_reviewed_by text default null
)
returns table (
  reviewer text, writer text,
  unreviewed bigint, approved bigint, disapproved bigint, no_note bigint, skipped bigint,
  largest_views bigint, largest_votes int, largest_helpful int, largest_not_helpful int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_views everything_item_views := everything_item_views();
begin
  return query
  select v_reviewer, s.writer, c.*, l.*
    from everything_claude_settings s,
    lateral (
      select count(*) filter (where everything_claude_in_section(d, 'unreviewed', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'approved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'disapproved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'no_note', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'skipped', v_reviewer))
        from everything_claude_drafts d
       where everything_claude_draft_matches(d, v_views, p_ratings, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before)
         and (p_reviewed_by is null or d.reviewed_by = p_reviewed_by)
    ) c,
    lateral (
      select coalesce(max(everything_claude_draft_views(d, v_views)), 0),
             coalesce(max(n.feed_votes), 0),
             coalesce(max(n.helpful_count), 0),
             coalesce(max(n.not_helpful_count), 0)
        from everything_claude_drafts d
        left join everything_notes n on n.id = d.note_id
       where d.status <> 'not_a_note'
    ) l;
end;
$$;

-- One draft as the page shows it. Since migration 145 it also carries Jim's
-- and Nathan's votes on the live note, and each explanation the vote it
-- explains.
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
  -- [{ at, actor, text, vote }], oldest first: explanations given after a
  -- vote, with that vote (null when it was not recorded), and reasons of old
  -- rejections, whose vote is 'rejected'.
  explanations jsonb,
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
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', e.data ->> 'reason'),
                    'vote', case when e.type = 'rejected' then to_jsonb('rejected'::text) else e.data -> 'vote' end
                  ) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id
              and ((e.type = 'rejected' and coalesce(e.data ->> 'reason', '') <> '') or e.type = 'explained')
         ), '[]'::jsonb),
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

-- 4. Who may call what. As in migration 130, every grant is spelled out.
revoke all on function
  everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz, text),
  everything_claude_review_rows(uuid[], text, everything_item_views),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
from public, anon, authenticated;

grant execute on function
  everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz, text),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
to authenticated, service_role;
