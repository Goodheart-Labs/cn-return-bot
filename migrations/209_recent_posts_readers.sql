-- The dashboard's Recently checked posts table shows how many people opened
-- each post, and no longer counts its claims (GOO-894).
--
-- Jim wanted to see each post's own visits next to its author's average, and
-- had no more use for the Claims and Checked columns. So the function returns
-- two new numbers for each post and drops the two claim counts:
--   readers  the different reader hashes that ever opened the post. This is
--            the same unit as the author's readers per post, the creator
--            ranking and the post list's list_readers.
--   visits   every visit row of the post, with or without a reader hash. A
--            visit has no reader hash when the extension could not name the
--            page's creator, which happened to about a quarter of YouTube
--            visits in November 2026. So visits can be higher than readers
--            for reasons other than people coming back.
-- Both count since the first visit, with no time window, like the author's
-- average. A LessWrong post's /comments page counts for the post, as in
-- migrations 183 and 201.
--
-- The visits table has no index on the page, so counting the visits of 25
-- posts read the whole table: 61 ms for 155,000 rows on 2026-11-27, growing by
-- about 5,000 rows a day. With the index below, the count looks up only the
-- listed posts' rows. On a copy of production's rows that took 0.5 ms.
--
-- ORDER: apply before the website deploys. The old website then shows empty
-- Claims and Checked cells until it deploys. UNDO: run the definition and
-- grants of everything_recent_posts from migration 141 again, and drop the
-- index.

create index everything_link_visits_page_url_idx on everything_link_visits (page_url);

drop function everything_recent_posts(int, timestamptz, uuid, int);

create function everything_recent_posts(
  last_posts int,
  p_after_processed_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 25
) returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  author_visitors_per_post float8,
  readers bigint,
  visits bigint,
  notes bigint
)
language sql stable security definer set search_path = public as $$
  with recent as (
    select i.id, i.title, i.url, i.project_id, i.checked_scope, i.published_at, i.processed_at,
           everything_visit_page(i.url) as page_url
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
      and (p_after_id is null or (i.processed_at, i.id) < (p_after_processed_at, p_after_id))
    order by i.processed_at desc, i.id desc
    limit least(greatest(p_limit, 1), 100)
  ),
  author_score as (
    select p.id as project_id, s.visitors_per_post
    from everything_projects p
    cross join lateral everything_creator_visit_score(lower(rtrim(p.feed_url, '/')), last_posts) s
    where p.id in (select recent.project_id from recent)
      and p.feed_url is not null
  ),
  page_visits as (
    select regexp_replace(v.page_url, '/comments$', '') as page_url,
           count(distinct v.reader_hash) as readers,
           count(*) as visits
    from everything_link_visits v
    where v.page_url in (select recent.page_url from recent
                         union all
                         select recent.page_url || '/comments' from recent)
    group by 1
  ),
  note_counts as (
    select c.item_id, count(*) as notes
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
      and n.author_id is null
      and n.status <> 'hidden'
    group by c.item_id
  )
  select
    r.id, r.title, r.url, p.name, r.checked_scope, r.published_at, r.processed_at,
    s.visitors_per_post,
    coalesce(pv.readers, 0), coalesce(pv.visits, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join author_score s on s.project_id = r.project_id
  left join page_visits pv on pv.page_url = r.page_url
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc, r.id desc
$$;

-- The function returns only counts, so like before anyone with the website's
-- key may call it.
revoke all on function everything_recent_posts(int, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function everything_recent_posts(int, timestamptz, uuid, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
