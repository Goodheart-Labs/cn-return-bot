-- 155: a note sent to Typefully counts as scheduled on X until Typefully
-- has published it (GOO-623).
--
-- Until now the local posting tool marked a note as posted on X as soon as it
-- had created the Typefully draft. Now that mark is 'scheduled'. The tool asks
-- Typefully about every scheduled note when it starts and every few minutes
-- while it runs, and reports what it learnt through
-- everything_update_x_post:
-- - When the tweet is out, the mark becomes 'posted', with the moment it was
--   published and the tweet's address.
-- - When the draft was deleted in Typefully, the mark goes, and the note
--   counts as not posted again.
-- - While it waits, the scheduled time follows the draft, which can be moved
--   in Typefully.
-- The review page's field row gets that time and the tweet's address.
-- This migration only adds, so it goes live before the website that uses it.

alter table everything_note_x_marks drop constraint everything_note_x_marks_mark_check;
alter table everything_note_x_marks
  add constraint everything_note_x_marks_mark_check check (mark in ('scheduled', 'posted', 'wont_post')),
  add constraint everything_note_x_marks_scheduled_draft check (mark <> 'scheduled' or typefully_draft_id is not null),
  -- Set when Typefully published the tweet. Null for a note an admin marked
  -- as posted by hand.
  add column published_at timestamptz,
  add column tweet_url text check (tweet_url ~ '^https://(x|twitter)\.com/');
comment on table everything_note_x_marks is
  'Whether a note is scheduled on X through Typefully, was posted on X, or the admins decided not to post it (GOO-623). No row means not posted yet.';

-- Brings a scheduled note's mark up to date with its Typefully draft. p_state
-- is what Typefully says about the draft: 'scheduled', 'published' or
-- 'deleted'. Only a mark that is still 'scheduled' for this very draft
-- changes, so a mark an admin set in the meantime always wins.
create function everything_update_x_post(p_note uuid, p_draft_id text, p_state text, p_scheduled_for timestamptz default null, p_published_at timestamptz default null, p_tweet_url text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform everything_claude_actor(null);
  if p_state = 'deleted' then
    delete from everything_note_x_marks where note_id = p_note and mark = 'scheduled' and typefully_draft_id = p_draft_id;
  elsif p_state = 'published' then
    update everything_note_x_marks
       set mark = 'posted', published_at = coalesce(p_published_at, now()), tweet_url = p_tweet_url
     where note_id = p_note and mark = 'scheduled' and typefully_draft_id = p_draft_id;
    -- Until migration 156 the leaderboard reads its own posted_at.
    if found then
      update everything_best_notes set posted_at = coalesce(p_published_at, now()) where note_id = p_note;
    end if;
  elsif p_state = 'scheduled' then
    update everything_note_x_marks set scheduled_for = p_scheduled_for
     where note_id = p_note and mark = 'scheduled' and typefully_draft_id = p_draft_id;
  else
    raise exception 'Unknown Typefully state %', p_state;
  end if;
end;
$$;

alter type everything_review_field_row
  -- When the note is scheduled to go out on X, or when it went out.
  add attribute x_time timestamptz,
  add attribute x_tweet_url text;

-- As in migration 154, with the time and address of the note's tweet.
create or replace function everything_review_field_rows(p_reviewer text, p_views everything_item_views, p_ids uuid[] default null)
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
         (select count(distinct src ->> 'url')::int from jsonb_array_elements(d.sources) src),
         coalesce(p.x_handle_status, 'unknown'),
         p.x_handle,
         p.x_handle_evidence,
         case x.mark when 'scheduled' then x.scheduled_for when 'posted' then x.published_at end,
         x.tweet_url
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

revoke all on function everything_update_x_post(uuid, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function everything_update_x_post(uuid, text, text, timestamptz, timestamptz, text) to authenticated, service_role;
