-- The second half of the post list (GOO-791). Drops what nothing reads since
-- migration 184 and the code of its PR: the assignments of migration 168, the
-- breaks after failures, the queue's tiers (everything_items.priority) and
-- queued_at, the feed run's failure watermark, and the all-time top posts.
--
-- Three functions still read the tiers, and are rewritten here on what
-- replaced them:
--   - everything_feed_pacing: a feed post is one whose pipeline runs spent no
--     reader money, and the last feed start is that of a post nobody asked for.
--   - everything_creator_ranking, the dashboard's ranking: a creator is
--     followed since the first post of theirs that no reader asked for, and
--     the top posts it left out are gone.
--   - everything_start_minisite_check: it marks the article as requested.
-- The list's trigger no longer reads priority either.
--
-- ORDER: apply once cn-walk ran for a day and the code of GOO-791 is merged,
-- because the old feed run reads all of this.
-- UNDO: none. The assignments live on as reservations with the same ids.

CREATE OR REPLACE FUNCTION public.everything_feed_pacing(window_hours integer, min_posts integer, fallback_hours integer, not_before timestamp with time zone)
 RETURNS TABLE(db_now timestamp with time zone, spent_today_usd numeric, mean_post_cost_usd numeric, sample_posts bigint, sample_hours integer, last_feed_started_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with posts as (
    select i.id, i.processed_at
    from everything_items i
    where i.status = 'done'
      and i.checked_scope = 'page'
      and not exists (select 1 from everything_pipeline_runs r where r.item_id = i.id and r.work_priority = 'reader')
      and i.processed_at >= greatest(now() - make_interval(hours => fallback_hours), not_before)
      and exists (select 1 from everything_pipeline_runs r where r.item_id = i.id)
  ),
  cost_rows as (
    select r.item_id, r.cost
    from everything_pipeline_runs r
    join posts p on p.id = r.item_id
    union all
    select c.item_id, r.cost
    from everything_claims c
    join posts p on p.id = c.item_id
    join everything_pipeline_runs r on r.claim_id = c.id
  ),
  post_cost as (
    select p.id, p.processed_at, coalesce(sum(cr.cost), 0) as cost
    from posts p
    left join cost_rows cr on cr.item_id = p.id
    group by p.id, p.processed_at
  ),
  recent as (
    select count(*) as n, avg(cost) as mean
    from post_cost
    where processed_at >= now() - make_interval(hours => window_hours)
  ),
  wide as (
    select count(*) as n, avg(cost) as mean from post_cost
  ),
  chosen as (
    select
      case when recent.n >= min_posts then recent.mean else wide.mean end as mean,
      case when recent.n >= min_posts then recent.n else wide.n end as n,
      case when recent.n >= min_posts then window_hours else fallback_hours end as hours
    from recent, wide
  )
  select
    now(),
    (select coalesce(sum(cost), 0)
       from everything_pipeline_runs
      where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    chosen.mean,
    chosen.n,
    chosen.hours,
    (select max(i.started_at)
       from everything_items i
      where i.requested_since is null
        and i.status <> 'error'
        and (i.status <> 'done' or exists (select 1 from everything_pipeline_runs r where r.item_id = i.id)))
  from chosen;
$function$;

CREATE OR REPLACE FUNCTION public.everything_creator_ranking(last_posts integer, min_score double precision, min_posts integer, unread_posts double precision, average_posts double precision)
 RETURNS TABLE(feed_url text, project_slug text, project_name text, priority_until timestamp with time zone, visitors_per_post double precision, score_posts bigint, people bigint, delay_posts bigint, median_delay_hours double precision, vote_posts bigint, vote_visitors bigint, extension_voters bigint, average_readers_per_post double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    cross join population pop
    where p.priority_until > now()
       or (s.posts >= min_posts
           and (s.visitors_per_post * s.posts + average_posts * pop.average_readers) / (s.posts + average_posts + unread_posts) >= min_score)
  ),
  followed_since as (
    select w.creator_key, min(i.created_at) as first_walked_at
    from walked w
    join everything_items i on i.project_id = w.project_id
    where not exists (select 1 from everything_note_requests r where r.item_id = i.id)
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
$function$;

CREATE OR REPLACE FUNCTION public.everything_start_minisite_check(target_minisite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_item everything_items;
begin
  if not (everything_is_admin() or auth.role() = 'service_role') then
    raise exception 'only admins can start a fact-check' using errcode = 'insufficient_privilege';
  end if;
  select i.* into target_item from everything_items i join everything_minisites m on m.item_id = i.id where m.id = target_minisite;
  if not found then
    raise exception 'no such minisite' using errcode = 'no_data_found';
  end if;
  if target_item.status in ('queued', 'processing') then
    return;
  end if;
  if target_item.checked_scope = 'page' and target_item.status = 'done' then
    raise exception 'this article was already fact-checked' using errcode = 'check_violation';
  end if;
  update everything_items
     set status = 'queued', requested_since = coalesce(requested_since, now()), checked_scope = 'page', error = null
   where id = target_item.id;
  insert into everything_minisite_jobs (kind, minisite_id, requested_by) values ('fact_check', target_minisite, auth.uid());
end;
$function$;

-- Since this migration a request is only requested_since, which intake and
-- the minisite fact-check set themselves.
create or replace function everything_items_list_fields() returns trigger
language plpgsql set search_path = public as $$
declare
  v_counts record;
begin
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done'
     and new.requested_since is not distinct from old.requested_since then
    new.requested_since := null;
  end if;
  new.list_requested := new.requested_since is not null;
  new.list_date := coalesce(new.demanded_at::date, new.published_at, new.created_at::date);
  new.list_rank := coalesce((select p.list_rank from everything_projects p where p.id = new.project_id), 0);
  -- A page readers opened ranks like a post of its creator holding priority.
  if new.demanded_at is not null then
    new.list_rank := everything_priority_rank() + mod(new.list_rank, everything_priority_rank());
  end if;
  new.list_open := new.full_text is not null and (new.source <> 'youtube' or new.caption_cues is not null)
                   and (new.list_requested or new.list_date >= current_date - everything_list_days());
  if tg_op = 'INSERT' or new.requested_since is distinct from old.requested_since then
    select * into v_counts from everything_item_reservation_counts(new.id, new.requested_since);
    new.list_team_count := v_counts.team;
    new.list_all_count := v_counts.everyone;
  end if;
  return new;
end;
$$;
drop index if exists everything_items_queue_idx;
drop function notewriter_take_back_overdue();
drop function notewriter_feed_posts_wanted();
drop function everything_item_is_prepared(everything_items);
drop table everything_assignments;
alter table everything_notewriters drop column cooldown_until, drop column failures_in_a_row;
drop trigger everything_items_queued_at on everything_items;
drop function everything_items_stamp_queued_at();
alter table everything_items drop column queued_at, drop column priority;
alter table everything_feed_schedule drop column failures_reported_through;
drop table everything_top_posts;
alter table everything_projects drop column top_posts_refreshed_at, drop column top_posts_attempted_at;

notify pgrst, 'reload schema';
