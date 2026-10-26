-- 142: the Claude note writer takes as many posts as Nathan's weekly usage
-- allows (GOO-587).
--
-- 1. The walk takes every visited creator. A creator no longer needs a score
--    of at least 1 over at least 2 visited posts. The dashboard's creator
--    ranking lists what the walk would walk, so its two functions lose the
--    min_score and min_posts arguments. The list grows from about 100 to about
--    4,800 creators. A page of it took 350 ms on prod on 2026-10-26.
-- 2. The feed run may set its alarm for the Claude note writer's next post,
--    with the new reason 'usage'.
-- 3. everything_claude_settings.posts_in_flight is dropped. The feed run now
--    spaces Claude's posts by the weekly usage, and gives Claude a new post
--    only while fewer than 3 feed posts are in the queue.

-- ---------------------------------------------------------------------------
-- 1. The creator ranking without a threshold.

drop function everything_creator_ranking_page(int, float8, int, float8, float8, text, int);
drop function everything_creator_ranking(int, float8, int, float8, float8);

create function everything_creator_ranking(last_posts int, unread_posts float8, average_posts float8)
returns table (
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
  average_readers_per_post float8
)
language sql
stable
security definer
set search_path = public
as $$
  with score as (
    select lower(rtrim(s.feed_url, '/')) as creator_key, s.feed_url, s.visitors_per_post, s.posts, s.people
    from everything_creator_visits s
  ),
  population as (
    select sum(visitors_per_post * posts) / nullif(sum(posts), 0) as average_readers from score
  ),
  walked as (
    select coalesce(lower(rtrim(p.feed_url, '/')), s.creator_key) as creator_key,
           coalesce(p.feed_url, s.feed_url) as feed_url,
           p.id as project_id, p.slug, p.name,
           case when p.priority_until > now() then p.priority_until end as priority_until,
           s.visitors_per_post, s.posts, s.people
    from (select * from everything_projects where feed_url is not null) p
    full join score s on s.creator_key = lower(rtrim(p.feed_url, '/'))
    where p.priority_until > now()
       or s.creator_key is not null
  ),
  followed_since as (
    select w.creator_key, min(i.created_at) as first_walked_at
    from walked w
    join everything_items i on i.project_id = w.project_id
    where i.priority < 2
    group by w.creator_key
  ),
  delay as (
    select w.creator_key,
           count(*) as posts,
           percentile_cont(0.5) within group (order by extract(epoch from d.first_checked_at - d.published_time) / 3600) as median_hours
    from walked w
    join followed_since f using (creator_key)
    cross join lateral (
      select i.published_time, i.first_checked_at
      from everything_items i
      where i.project_id = w.project_id
        and i.status = 'done'
        and i.checked_scope = 'page'
        and i.published_time is not null
        and i.first_checked_at is not null
        and i.published_time >= f.first_walked_at
        and not exists (select 1 from everything_top_posts t where t.url = i.url)
      order by i.published_time desc
      limit last_posts
    ) d
    group by w.creator_key
  ),
  noted_page as (
    select w.creator_key, everything_visit_page(i.url) as page_url,
           array_agg(distinct i.id) as item_ids, min(n.created_at) as first_note_at
    from walked w
    join everything_items i on i.project_id = w.project_id
    join everything_claims c on c.item_id = i.id
    join everything_notes n on n.claim_id = c.id
    group by 1, 2
  ),
  visited_noted_page as (
    select np.creator_key, np.page_url, np.item_ids,
           count(distinct v.reader_hash) as visitors,
           row_number() over (partition by np.creator_key order by max(v.visited_at) desc, np.page_url) as recency
    from noted_page np
    join everything_link_visits v
      on lower(rtrim(v.feed_url, '/')) = np.creator_key
     and v.page_url = np.page_url
     and v.reader_hash is not null
     and v.visited_at >= np.first_note_at
    group by np.creator_key, np.page_url, np.item_ids
  ),
  team_account as (
    select u.id
    from auth.users u
    join everything_admins a on a.email = lower(u.email)
  ),
  page_voters as (
    select vp.creator_key, vp.page_url, count(distinct vt.voter_id) as voters
    from visited_noted_page vp
    join everything_claims c on c.item_id = any (vp.item_ids)
    join everything_notes n on n.claim_id = c.id
    join everything_votes vt on vt.note_id = n.id
    where vp.recency <= last_posts
      and vt.platform = 'extension'
      and vt.voter_id not in (select id from team_account)
    group by vp.creator_key, vp.page_url
  ),
  votes as (
    select vp.creator_key,
           count(*) as posts,
           sum(vp.visitors)::bigint as visitors,
           coalesce(sum(pv.voters), 0)::bigint as voters
    from visited_noted_page vp
    left join page_voters pv using (creator_key, page_url)
    where vp.recency <= last_posts
    group by vp.creator_key
  )
  select w.feed_url, w.slug, w.name, w.priority_until,
         w.visitors_per_post, w.posts, w.people,
         d.posts, d.median_hours,
         vo.posts, vo.visitors, vo.voters,
         (select average_readers from population)
  from walked w
  left join delay d using (creator_key)
  left join votes vo using (creator_key);
$$;

comment on function everything_creator_ranking(int, float8, float8) is
  'The creators the auto-enqueue walk would go through now: open priority, or any visit by a reader with the extension. Per creator: the plain average of people per post, the median hours from the exact publication time to the first finished check over their last_posts most recently published checked posts published after the walk first enqueued anything from them and outside their top list, extension voters and visitors summed over their last_posts most recently visited posts with notes, and the average readers per post that the score''s average_posts imagined posts use (GOO-531, GOO-549, GOO-587).';

-- The walk's order over the whole ranking: priority first, then the score with
-- the imagined posts, then the most different readers, then the feed address.
-- Each page scores every creator before it can sort them, about 4,800 on
-- 2026-10-26, read from the view migration 135 refreshes once a day.
create function everything_creator_ranking_page(
  last_posts int, unread_posts float8, average_posts float8,
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
      from everything_creator_ranking(last_posts, unread_posts, average_posts) r
  )
  select k.* from ranked k
   where p_after_feed_url is null
      or (k.priority_until is null, -k.walk_score, -coalesce(k.people, 0), k.feed_url)
         > (select a.priority_until is null, -a.walk_score, -coalesce(a.people, 0), a.feed_url from ranked a where a.feed_url = p_after_feed_url)
   order by k.priority_until is null, k.walk_score desc, coalesce(k.people, 0) desc, k.feed_url
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function everything_creator_ranking(int, float8, float8) from public, anon, authenticated;
revoke all on function everything_creator_ranking_page(int, float8, float8, text, int) from public, anon, authenticated;
grant execute on function
  everything_creator_ranking(int, float8, float8),
  everything_creator_ranking_page(int, float8, float8, text, int)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The alarm's new reason.

alter table everything_feed_schedule drop constraint everything_feed_schedule_next_run_reason_check;
alter table everything_feed_schedule add constraint everything_feed_schedule_next_run_reason_check
  check (next_run_reason in ('interval', 'midnight', 'idle', 'usage'));
comment on column everything_feed_schedule.next_run_reason is
  'interval: one pacing interval after the last post started. midnight: the money left does not cover one average post. idle: the run found nothing to process. usage: the Claude note writer''s next post is due, spaced so that Nathan''s weekly usage reaches its target by the reset.';

-- ---------------------------------------------------------------------------
-- 3. The settings without posts_in_flight.

drop function everything_claude_change_settings(text, boolean, text, int);
alter table everything_claude_settings drop column posts_in_flight;

create function everything_claude_change_settings(
  p_writer text default null,
  p_approval_required boolean default null,
  p_actor text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  update everything_claude_settings
     set writer = coalesce(p_writer, writer),
         approval_required = coalesce(p_approval_required, approval_required),
         updated_at = now(),
         updated_by = v_actor
   where id;
  insert into everything_claude_events (actor, type, data)
  values (v_actor, 'settings_changed', jsonb_strip_nulls(jsonb_build_object('writer', p_writer, 'approvalRequired', p_approval_required)));
end;
$$;

revoke execute on function everything_claude_change_settings(text, boolean, text) from public, anon, authenticated;
grant execute on function everything_claude_change_settings(text, boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';
