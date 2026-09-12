-- 094: the Common Notes dashboard's list of recently checked posts.
--
-- One row per post the pipeline finished most recently, newest first: its
-- title, project, publish date and check time, how much its author is being
-- read, and what the pipeline got out of it (claims extracted, claims
-- checked, notes written). A post counts as finished under the same rule as
-- the pipeline funnel in migration 092: status done, a checked scope, and a
-- processed_at stamp.
--
-- The author's visits and readers are those of the post's project over the
-- last window_days days, which is the number the pipeline walks creators on
-- (VISIT_RANKING_WINDOW_DAYS in src/everything-shared/readers.ts). A visit
-- belongs to a project the same way everything_creator_visits (migration 089)
-- decides it: through the post it names, or else through the creator's feed
-- address the extension read off the page, with a Substack host standing in
-- when there is none.

-- An earlier draft of this migration matched visits to single posts through
-- a page-key helper. Both are replaced, and the return type changed, so the
-- old versions are dropped first.
drop function if exists everything_recent_posts(int);
drop function if exists everything_page_key(text);

-- max_posts is capped, so a caller cannot ask for every post ever checked.
create or replace function everything_recent_posts(max_posts int default 100, window_days int default 14)
returns table (
  id uuid,
  title text,
  url text,
  project text,
  checked_scope text,
  published_at date,
  processed_at timestamptz,
  author_visits bigint,
  author_readers bigint,
  claims_extracted bigint,
  claims_checked bigint,
  notes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select i.id, i.title, i.url, i.project_id, i.checked_scope, i.published_at, i.processed_at
    from everything_items i
    where i.status = 'done'
      and i.checked_scope is not null
      and i.processed_at is not null
    order by i.processed_at desc
    limit least(greatest(max_posts, 1), 200)
  ),
  visit as (
    select
      v.item_id,
      v.reader_hash,
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url
    from everything_link_visits v
    where v.visited_at >= now() - make_interval(days => window_days)
  ),
  attributed as (
    select coalesce(item.project_id, feed_project.id) as project_id, visit.reader_hash
    from visit
    left join everything_items item on item.id = visit.item_id
    left join everything_projects feed_project
      on visit.feed_url is not null
     and lower(feed_project.feed_url) = lower(visit.feed_url)
  ),
  author_counts as (
    select attributed.project_id, count(*) as visits, count(distinct attributed.reader_hash) as readers
    from attributed
    where attributed.project_id in (select recent.project_id from recent)
    group by attributed.project_id
  ),
  claim_counts as (
    select c.item_id,
           count(*) as extracted,
           count(*) filter (where c.status in ('note', 'no_note', 'error')) as checked
    from everything_claims c
    where c.item_id in (select recent.id from recent)
      and c.created_by is null
    group by c.item_id
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
    coalesce(ac.visits, 0), coalesce(ac.readers, 0),
    coalesce(cc.extracted, 0), coalesce(cc.checked, 0), coalesce(nc.notes, 0)
  from recent r
  left join everything_projects p on p.id = r.project_id
  left join author_counts ac on ac.project_id = r.project_id
  left join claim_counts cc on cc.item_id = r.id
  left join note_counts nc on nc.item_id = r.id
  order by r.processed_at desc
$$;

comment on function everything_recent_posts(int, int) is
  'The posts the pipeline finished most recently (up to 200), newest first, with their author''s visits and distinct readers over the last window_days days (attributed as in everything_creator_visits), claims extracted, claims checked and AI notes written.';

revoke all on function everything_recent_posts(int, int) from public;
grant execute on function everything_recent_posts(int, int) to anon, authenticated;
