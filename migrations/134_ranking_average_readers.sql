-- 134: the creator ranking computes the average readers per post itself
-- (GOO-549).
--
-- The creator score adds imagined posts with the average number of readers per
-- post (creatorScore in src/everything-core/readers.ts). Migration 132 took
-- that average as an argument, and the code passed a fixed 1.07, measured once
-- on 2026-10-23. A fixed number goes stale as readers arrive. Now the walk and
-- this function both compute it on every call, over the same creators: every
-- creator everything_creator_visit_scores returns, weighted by their visited
-- posts. The function already reads all of them for the score, so this costs
-- nothing more. It returns the average in every row, so the dashboard can
-- compute the same score the walk uses. The argument is gone and a column is
-- new, so the function is dropped and created again. Everything else is as in
-- migration 133.

drop function everything_creator_ranking(int, float8, int, float8, float8, float8);

create function everything_creator_ranking(
  last_posts int, min_score float8, min_posts int,
  unread_posts float8, average_posts float8
)
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
    from everything_creator_visit_scores(last_posts) s
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

comment on function everything_creator_ranking(int, float8, int, float8, float8) is
  'The creators the auto-enqueue walk would go through now: open priority, or at least min_posts visited posts and a score of at least min_score, where the score counts unread_posts imagined posts nobody read and average_posts with the average readers per post over all visited creators. Per creator: the plain average of people per post, the median hours from the exact publication time to the first finished check over their last_posts most recently published checked posts published after the walk first enqueued anything from them and outside their top list, extension voters and visitors summed over their last_posts most recently visited posts with notes, and the average readers per post the score used (GOO-531, GOO-549).';

revoke execute on function everything_creator_ranking(int, float8, int, float8, float8) from public;
grant execute on function everything_creator_ranking(int, float8, int, float8, float8) to anon, authenticated, service_role;
