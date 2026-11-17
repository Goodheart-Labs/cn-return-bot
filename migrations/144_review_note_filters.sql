-- 144: the review page gets the All notes page's filters (GOO-563).
--
-- Besides the crowd-rating filter of migration 143, the review page now
-- narrows every section the way the All notes page narrows its feed: minimum
-- views, votes, Helpful votes and Not helpful votes, and "only notes I haven't
-- voted on". The counts are the ones the feed uses (migration 141): views are
-- the devices outside the team that were shown the post's notes, and the vote
-- counts include the author's own automatic vote. A draft without a live note
-- has its post's views but no votes. Each card also shows its post's views.

drop function everything_claude_review_summary(text[]);
drop function everything_claude_review_page(text, text[], timestamptz, uuid, int);
drop function everything_claude_review_drafts(uuid[]);
drop function everything_claude_review_rows(uuid[], text);
drop type everything_claude_review_draft;

-- How many devices outside the team were shown the notes of the draft's post.
create function everything_claude_draft_views(d everything_claude_drafts, p_views everything_item_views) returns bigint
language sql immutable as $$
  select coalesce(p_views.viewers[array_position(p_views.item_ids, d.item_id)], 0)
$$;

-- Whether a draft passes the filters. The notes the reader had voted on before
-- `p_voted_before` count as voted on, so a vote cast while reviewing never
-- makes its card vanish.
create function everything_claude_draft_matches(
  d everything_claude_drafts,
  p_views everything_item_views,
  p_ratings text[],
  p_min_views int,
  p_min_votes int,
  p_min_helpful int,
  p_min_not_helpful int,
  p_unvoted_only boolean,
  p_voted_before timestamptz
) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_ratings is null or everything_claude_crowd_rating(d.note_id) = any (p_ratings))
     and everything_claude_draft_views(d, p_views) >= coalesce(p_min_views, 0)
     and coalesce(n.feed_votes, 0) >= coalesce(p_min_votes, 0)
     and coalesce(n.helpful_count, 0) >= coalesce(p_min_helpful, 0)
     and coalesce(n.not_helpful_count, 0) >= coalesce(p_min_not_helpful, 0)
     and (not coalesce(p_unvoted_only, false) or not exists (
           select 1 from everything_votes v
            where v.note_id = d.note_id and v.voter_id = auth.uid() and v.created_at < coalesce(p_voted_before, now())))
    from (select 1) one
    left join everything_notes n on n.id = d.note_id
$$;

-- The page's header: who is reviewing, the settings, how many drafts each
-- section holds under the filters, and the largest view and vote counts of
-- any note, where the filter sliders end.
create function everything_claude_review_summary(
  p_ratings text[] default null,
  p_min_views int default 0,
  p_min_votes int default 0,
  p_min_helpful int default 0,
  p_min_not_helpful int default 0,
  p_unvoted_only boolean default false,
  p_voted_before timestamptz default null
)
returns table (
  reviewer text, writer text, approval_required boolean,
  unreviewed bigint, waiting bigint, approved bigint, disapproved bigint, no_note bigint, skipped bigint,
  largest_views bigint, largest_votes int, largest_helpful int, largest_not_helpful int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_views everything_item_views := everything_item_views();
begin
  return query
  select v_reviewer, s.writer, s.approval_required, c.*, l.*
    from everything_claude_settings s,
    lateral (
      select count(*) filter (where everything_claude_in_section(d, 'unreviewed', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'waiting', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'approved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'disapproved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'no_note', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'skipped', v_reviewer))
        from everything_claude_drafts d
       where everything_claude_draft_matches(d, v_views, p_ratings, p_min_views, p_min_votes, p_min_helpful, p_min_not_helpful, p_unvoted_only, p_voted_before)
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

-- One draft as the page shows it: migration 143's row and the post's views.
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
  -- Whether the reviewer reading the page skipped the draft.
  skipped boolean,
  -- [{ at, actor, text }], oldest first: reasons of old rejections and
  -- explanations given after a vote.
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
         exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer),
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', e.data ->> 'reason')) order by e.id)
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
  if p_section not in ('unreviewed', 'waiting', 'approved', 'disapproved', 'no_note', 'skipped') then
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

-- Who may call what. As in migration 130, every grant is spelled out.
revoke all on function
  everything_claude_draft_views(everything_claude_drafts, everything_item_views),
  everything_claude_draft_matches(everything_claude_drafts, everything_item_views, text[], int, int, int, int, boolean, timestamptz),
  everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz),
  everything_claude_review_rows(uuid[], text, everything_item_views),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
from public, anon, authenticated;

grant execute on function
  everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz),
  everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
to authenticated, service_role;
