-- 154: remove what migration 153 replaced, now that the new review page is
-- live (GOO-623).
--
-- 153 only added, so the old website kept working while its pull request
-- waited. Now:
-- 1. Leaderboard notes marked as posted on the old website since 153 get
--    their X mark too, and the leaderboard's posted_at column goes. The
--    leaderboard reads the mark from everything_note_x_marks, and
--    everything_set_x_mark stops writing posted_at.
-- 2. The review page's section functions of migrations 143 to 151 go, and
--    with them the crowd rating helpers, whose rules the field row holds.

-- 1. One X mark.

insert into everything_note_x_marks (note_id, mark, marked_at)
select note_id, 'posted', posted_at from everything_best_notes where posted_at is not null
on conflict (note_id) do nothing;
alter table everything_best_notes drop column posted_at;

-- Sets or clears a note's X mark. A null mark clears it.
create or replace function everything_set_x_mark(p_note uuid, p_mark text, p_typefully_draft_id text default null, p_scheduled_for timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
begin
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

-- The leaderboard's page reads its "Posted on X" mark from
-- everything_note_x_marks. Otherwise as in migration 141.
create or replace function everything_curation_page(
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
      select b.note_id, b.position as sort_key, b.position, b.comment, null::timestamptz as removed_at, null::text as removed_reason
        from everything_best_notes b
       where p_section = 'leaderboard'
      union all
      select r.note_id, r.position, r.position, r.comment, null, null
        from everything_note_recommendations r
       where p_section = 'recommendations' and r.moved_at is null and r.removed_at is null
      union all
      select r.note_id, -extract(epoch from r.removed_at)::float8, null, null, r.removed_at, r.removed_reason
        from everything_note_recommendations r
       where p_section = 'removed' and r.removed_at is not null
    )
    select s.note_id, s.sort_key, s.position, s.comment, m.marked_at, s.removed_at, s.removed_reason
      from section_rows s
      join everything_notes n on n.id = s.note_id and n.status <> 'hidden'
      join everything_claims c on c.id = n.claim_id
      join everything_items i on i.id = c.item_id
      left join everything_projects p on p.id = i.project_id
      left join everything_note_x_marks m on m.note_id = s.note_id and m.mark = 'posted'
     where (p_project_slug is null or p.slug = p_project_slug)
       and (not p_not_posted_only or m.note_id is null)
       and (not p_unvoted_only or not exists (
             select 1 from everything_votes v
              where v.note_id = s.note_id and v.voter_id = auth.uid() and v.created_at < coalesce(p_voted_before, now())))
       and (p_after_note_id is null or (s.sort_key, s.note_id) > (p_after_key, p_after_note_id))
     order by s.sort_key, s.note_id
     limit least(greatest(p_limit, 1), 100);
end;
$$;

-- 2. The old review functions.

drop function everything_claude_review_summary(text[], int, int, int, int, boolean, timestamptz, text);
drop function everything_claude_review_page(text, text[], int, int, int, int, boolean, timestamptz, text, timestamptz, uuid, int);
drop function everything_claude_review_drafts(uuid[]);
drop function everything_claude_review_rows(uuid[], text, everything_item_views);
drop function everything_claude_draft_matches(everything_claude_drafts, everything_item_views, text[], int, int, int, int, boolean, timestamptz);
drop function everything_claude_in_section(everything_claude_drafts, text, text);
drop function everything_claude_crowd_rating(uuid);
drop function everything_claude_crowd_status(uuid);
drop type everything_claude_review_draft;
