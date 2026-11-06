-- 171: the admins can decide that a note will not go on the leaderboard
-- (GOO-741).
--
-- Until now the review page knew only whether a note was on the leaderboard
-- (everything_best_notes). Jim asked on 2026-11-06 for a "Won't add to
-- leaderboard" button and a filter with three values: on the leaderboard, not
-- for the leaderboard, and undecided. So:
--
-- 1. A new table holds the notes an admin decided against. A note on the
--    leaderboard counts as on it even if it also has such a row, so adding a
--    declined note to the leaderboard needs no extra step.
-- 2. The review page's field `leaderboard` changes from yes or no to 'on',
--    'declined' or 'undecided'.

-- 1. The decisions.

create table everything_leaderboard_declines (
  note_id uuid primary key references everything_notes (id) on delete cascade,
  declined_by text not null check (declined_by in ('jim', 'nathan')),
  declined_at timestamptz not null default now()
);
comment on table everything_leaderboard_declines is
  'Notes an admin decided not to put on the leaderboard (GOO-741). No row means undecided, unless the note is on the leaderboard.';

alter table everything_leaderboard_declines enable row level security;
revoke all on everything_leaderboard_declines from anon, authenticated;
grant all on everything_leaderboard_declines to service_role;

-- Marks a note as not for the leaderboard, or takes the mark off. Only an
-- admin may call it, which everything_claude_actor checks.
create function everything_set_leaderboard_decline(p_note uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
begin
  if p_on then
    insert into everything_leaderboard_declines (note_id, declined_by) values (p_note, v_actor) on conflict do nothing;
  else
    delete from everything_leaderboard_declines where note_id = p_note;
  end if;
end;
$$;
revoke all on function everything_set_leaderboard_decline(uuid, boolean) from public, anon, authenticated;
grant execute on function everything_set_leaderboard_decline(uuid, boolean) to authenticated, service_role;

-- 2. The field.

alter type everything_review_field_row
  -- 'on' the leaderboard, 'declined' by an admin, or 'undecided'.
  alter attribute leaderboard set data type text;

-- As in migration 170, with the leaderboard decision.
create or replace function everything_review_field_rows(p_reviewer text, p_views everything_item_views, p_ids uuid[] default null)
returns setof everything_review_field_row
language sql stable security definer set search_path = public as $$
  with entries as materialized (
    select * from everything_review_entries(p_ids)
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
     where v.note_id in (select note_id from entries)
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
     where e.type in ('message', 'answer') and e.draft_id in (select draft_id from entries)
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
         case when b.note_id is not null then 'on' when ld.note_id is not null then 'declined' else 'undecided' end,
         f.draft_id is not null,
         case when lc.draft_id is null then 'none' when lc.actor = 'claude' then 'answered' else 'waiting' end,
         coalesce(d.review_note, '') <> '',
         char_length(d.note),
         (select count(distinct src ->> 'url')::int from jsonb_array_elements(d.sources) src),
         coalesce(p.x_handle_status, 'unknown'),
         p.x_handle,
         p.x_handle_evidence,
         case x.mark when 'scheduled' then x.scheduled_for when 'posted' then x.published_at end,
         x.tweet_url,
         d.source
    from entries d
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
    left join everything_claude_judgements j on j.draft_id = d.draft_id and j.note = d.note
    left join everything_claude_skips s on s.draft_id = d.draft_id and s.reviewer = p_reviewer
    left join everything_best_notes b on b.note_id = d.note_id
    left join everything_leaderboard_declines ld on ld.note_id = d.note_id
    left join everything_claude_few_shot_examples f on f.draft_id = d.draft_id
    left join last_chat lc on lc.draft_id = d.draft_id;
$$;

notify pgrst, 'reload schema';
