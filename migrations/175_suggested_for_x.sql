-- 175: the review page suggests which notes to post on X next.
--
-- Nathan asked on 2026-11-08: "Can you predict which ones you should shedule
-- and have that prehighlighted or something?" The new field `suggested_x`
-- marks the five notes that look most worth posting right now. Nathan still
-- posts each one himself; nothing is scheduled automatically.
--
-- The rule comes from the 22 notes posted on X before 2026-11-08 and the
-- team's leaderboard. With the votes each posted note had when its tweet went
-- out, 15 of the 22 were rated helpful and 6 more had two Helpful votes and
-- no other, a crowd chance of 0.746, just under the 0.78 of "rated helpful".
-- Of the 13 notes posted since October, 11 were written at most 11 days
-- before they went out. So a note is a candidate when all of these hold:
--
-- * it is on the site, it is not an improvement of another note (none of the
--   22 was), and its passage has not changed since it was written;
-- * it has no X mark: not scheduled, not posted, and not "We won't post this";
-- * neither Jim nor Nathan voted it Not helpful;
-- * it is on the leaderboard, or the crowd gives it at least a 0.74 chance of
--   being helpful and it was written in the last 14 days.
--
-- Each post keeps only its best candidate, because Nathan never posted two
-- notes on one post on the same day. The five candidates with the highest
-- crowd chance are suggested, ties going to more Helpful votes and then the
-- newer note. Once Nathan schedules a note or marks it, the next candidate
-- takes its place.
--
-- Migration 171 (PR 688, not applied when this was written) also rewrites
-- everything_review_field_rows from 170. Whichever is applied second must
-- carry the other's column.

create function everything_x_suggestions() returns table (note_id uuid)
language sql stable security definer set search_path = public as $$
  with candidates as (
    select n.id, n.p_helpful, n.helpful_count, n.created_at,
           row_number() over (partition by c.item_id order by n.p_helpful desc, n.helpful_count desc, n.created_at desc) as on_post
      from everything_notes n
      join everything_claims c on c.id = n.claim_id
      left join everything_best_notes b on b.note_id = n.id
     where n.status <> 'hidden'
       and n.improved_from_note_id is null
       and n.feed_band is distinct from 'stale'
       and (b.note_id is not null or (n.p_helpful >= 0.74 and n.created_at >= now() - interval '14 days'))
       and not exists (select 1 from everything_note_x_marks x where x.note_id = n.id)
       and not exists (
         select 1 from everything_votes v
          where v.note_id = n.id and v.vote < 0 and everything_reviewer_of(v.voter_id) is not null
       )
  )
  select id from candidates
   where on_post = 1
   order by p_helpful desc, helpful_count desc, created_at desc
   limit 5;
$$;

revoke all on function everything_x_suggestions() from public, anon, authenticated;
grant execute on function everything_x_suggestions() to service_role;

alter type everything_review_field_row
  -- Whether the note is one of the five suggested for X.
  add attribute suggested_x boolean;

-- As in migration 170, with the suggestion.
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
  suggested as materialized (
    select note_id from everything_x_suggestions()
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
         b.note_id is not null,
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
         d.source,
         sg.note_id is not null
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
    left join everything_claude_few_shot_examples f on f.draft_id = d.draft_id
    left join last_chat lc on lc.draft_id = d.draft_id
    left join suggested sg on sg.note_id = d.note_id;
$$;

notify pgrst, 'reload schema';
