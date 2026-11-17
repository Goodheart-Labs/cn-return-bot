-- 146: "Decided by" on the review page narrows only the sections where a
-- vote decided (GOO-563). In migration 145 the reviewer filter emptied the
-- counts of Not reviewed, No note and Skipped as well.

-- The page's header: who is reviewing, who writes the notes, how many drafts
-- each section holds under the filters, and the largest view and vote counts
-- of any note, where the filter sliders end. `p_reviewed_by` narrows only
-- Approved and Disapproved, the sections where a vote decided.
create or replace function everything_claude_review_summary(
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
             count(*) filter (where everything_claude_in_section(d, 'approved', v_reviewer) and (p_reviewed_by is null or d.reviewed_by = p_reviewed_by)),
             count(*) filter (where everything_claude_in_section(d, 'disapproved', v_reviewer) and (p_reviewed_by is null or d.reviewed_by = p_reviewed_by)),
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
