-- Following becomes priority, and the creator list folds into the projects
-- table (GOO-107).
--
-- Before this, a creator was a row in everything_followed_feeds carrying a
-- project_slug, a feed_type and a feed_url. Two of those three duplicated
-- something already known: the slug duplicated the project's own slug and the
-- type duplicated what the URL says. They had already drifted, which is the
-- bug this fixes. thezvi.substack.com was filed under project slug 'zvi',
-- @DwarkeshPatel under 'dwarkesh' and astralcodexten under 'acx'. A project is
-- found by slug and a missing slug creates a new project, so the first run of
-- the visit ranking would have given those three creators a second, empty
-- project each and split their notes on the public site.
--
-- After this a creator IS a project. everything_projects carries the feed URL
-- and, while it lies in the future, a priority window. There are exactly two
-- reasons the pipeline walks a creator: an unexpired priority_until, or at
-- least two visits in the last fourteen days. Nothing is permanent.
--
-- The browser extension writes this table directly with the public anon key.
-- A press grants exactly seven days and cannot name a project, because anon
-- holds an insert privilege on feed_url alone and the trigger below fills in
-- everything else.
--
-- Apply with scripts/migrate.sh so the whole file runs in one transaction, and
-- pause the pg_cron dispatch first (migrations 070 and 071 are the precedent):
-- the drops at the end take an exclusive lock, and a run in flight reads both
-- dropped tables.

-- ---------------------------------------------------------------------------
-- 0. Refuse a second run before touching anything. This file is deliberately
--    not idempotent: a half-idempotent migration can run its second half
--    against a table its first half did not create, which is worse than a
--    loud stop.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'everything_projects' and column_name = 'feed_url') then
    raise exception 'migration 086 has already been applied (everything_projects.feed_url exists)';
  end if;
  -- Two feeds sharing one project_slug would make the backfill's UPDATE ... FROM
  -- pick one of them silently. There are none today; stop if that ever changes.
  if exists (select 1 from everything_followed_feeds group by project_slug having count(*) > 1) then
    raise exception 'two followed feeds share a project_slug; the backfill would silently drop one';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The slug a feed URL derives to. This is canonicalFeed() in
--    src/everything/feedUrls.ts written as SQL, and the two must agree: the
--    pipeline derives the slug for a creator it meets through visits, and the
--    trigger below derives it for a creator it meets through a press.

create or replace function everything_feed_slug(feed_url text)
returns text
language sql
immutable
as $$
  select case
    when feed_url ~ '^https://(?!www\.)[\w-]+\.substack\.com$'
      then lower((regexp_match(feed_url, '^https://([\w-]+)\.substack\.com$'))[1])
    when feed_url ~ '^https://www\.youtube\.com/@[\w.-]+$'
      then lower((regexp_match(feed_url, '/@([\w.-]+)$'))[1])
    when feed_url ~ '^https://www\.youtube\.com/channel/[\w-]+$'
      then lower((regexp_match(feed_url, '/channel/([\w-]+)$'))[1])
    when feed_url ~ '^https://www\.(lesswrong\.com|alignmentforum\.org)/users/[\w.-]+$'
      then lower((regexp_match(feed_url, '/users/([\w.-]+)$'))[1])
  end
$$;

comment on function everything_feed_slug(text) is
  'The project slug a canonical feed URL derives to. Mirrors canonicalFeed() in src/everything/feedUrls.ts.';

-- ---------------------------------------------------------------------------
-- 2. The two new columns.
--
--    feed_url is unique but nullable, and a plain unique constraint rather than
--    a partial index: nulls are never equal in Postgres so unlimited nulls are
--    already allowed, and a partial index cannot be named as an upsert target.
--    Most projects keep it null -- "Around the web", ai-2040, anything imported
--    from local documents.
--
--    The shape CHECK is the only thing keeping a URL the parser cannot read out
--    of a table whose every reader assumes parsing succeeds, now that feed_type
--    is no longer stored.

alter table everything_projects
  add column feed_url text,
  add column priority_until timestamptz,
  add column top_posts_refreshed_at timestamptz;

alter table everything_projects
  add constraint everything_projects_feed_url_key unique (feed_url);

alter table everything_projects
  add constraint everything_projects_feed_url_shape check (
    feed_url is null
    or (char_length(feed_url) <= 512 and everything_feed_slug(feed_url) is not null)
  );

comment on column everything_projects.feed_url is
  'The creator''s canonical feed URL, exactly as canonicalFeed() emits it. Null for a project with no feed, such as a local document import or the catch-all web project.';
comment on column everything_projects.priority_until is
  'While this lies in the future the creator is walked ahead of creators that qualify only on visits. Set to seven days by a press in the extension or by everything-prioritize. Null means the creator is walked only if readers visit them.';
comment on column everything_projects.top_posts_refreshed_at is
  'When this creator''s everything_top_posts rows were last recomputed (GOO-81). Null means never. Moved here from everything_followed_feeds by migration 086.';

-- ---------------------------------------------------------------------------
-- 3. Carry the old list over. This join is the only record anywhere that
--    thezvi.substack.com is project 'zvi', so it has to happen before the drop
--    at the end of this file.
--
--    greatest() ignores nulls, so a creator with no manual flag gets exactly
--    "seven days from when they were requested", which for most of the list is
--    already in the past, while a flag somebody set deliberately is kept.

update everything_projects p
   set feed_url = regexp_replace(f.feed_url, '/+$', ''),
       priority_until = greatest(f.priority_until, f.created_at + interval '7 days'),
       top_posts_refreshed_at = f.top_posts_refreshed_at
  from everything_followed_feeds f
 where p.slug = f.project_slug;

-- A followed feed whose project does not exist yet keeps the slug it was
-- followed under, which is the slug the pipeline would have created anyway.
insert into everything_projects (slug, name, feed_url, priority_until, top_posts_refreshed_at)
select f.project_slug,
       f.project_slug,
       regexp_replace(f.feed_url, '/+$', ''),
       greatest(f.priority_until, f.created_at + interval '7 days'),
       f.top_posts_refreshed_at
  from everything_followed_feeds f
 where not exists (select 1 from everything_projects p where p.slug = f.project_slug);

-- ---------------------------------------------------------------------------
-- 4. A press grants seven days, decided here rather than by the client.
--
--    Created after the backfill on purpose: an insert trigger that fired during
--    the backfill would have re-stamped all two dozen historical rows with a
--    fresh seven days and silently re-prioritised every creator we own.
--
--    SECURITY DEFINER so the re-press path can update a row whose priority has
--    already expired, which the select policy hides and which anon has no
--    privilege to update. That is also why re-pressing cannot go through an
--    ordinary upsert: INSERT ... ON CONFLICT DO UPDATE requires the UPDATE
--    privilege whether or not a conflict happens, and anon deliberately has
--    none. The trigger performs the update itself and returns null to skip the
--    insert, so the statement affects no rows and the client must not read an
--    empty result as failure.

create or replace function everything_projects_press()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  granted timestamptz := now() + interval '7 days';
  base_slug text;
  candidate text;
  suffix int := 1;
  existing_id uuid;
begin
  -- The pipeline on service_role, and this migration on postgres, keep full
  -- control of every column. Only the two public PostgREST roles are overridden.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  new.feed_url := regexp_replace(btrim(coalesce(new.feed_url, '')), '/+$', '');
  base_slug := everything_feed_slug(new.feed_url);
  if base_slug is null then
    raise exception 'not a creator feed we recognise: %', new.feed_url using errcode = 'check_violation';
  end if;

  -- A creator we already know: extend the window, never shorten it, and leave
  -- their name, slug and everything else alone.
  select id into existing_id
    from everything_projects
   where lower(feed_url) = lower(new.feed_url)
     for update;
  if found then
    update everything_projects
       set priority_until = greatest(priority_until, granted)
     where id = existing_id;
    return null;
  end if;

  -- A creator we have never seen. The slug comes from the URL, so a press can
  -- neither choose what a project is called nor squat a name that is taken.
  candidate := base_slug;
  while exists (select 1 from everything_projects where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  new.slug := candidate;
  new.name := base_slug;
  new.description := null;
  new.sort_order := 0;
  new.priority_until := granted;
  return new;
end;
$$;

create trigger everything_projects_press
  before insert on everything_projects
  for each row execute function everything_projects_press();

-- ---------------------------------------------------------------------------
-- 5. Grants and policies.
--
--    The column grant is the first control and the trigger is the second: anon
--    cannot name priority_until in an insert at all, so even with the trigger
--    gone a client could not choose its own window. The insert policy is the
--    third, and it is evaluated on the row the trigger already rewrote.

grant insert (feed_url) on everything_projects to anon, authenticated;

create policy projects_insert_press on everything_projects
  for insert to anon, authenticated
  with check (
    feed_url is not null
    and priority_until is not null
    and priority_until <= now() + interval '7 days'
  );

-- No update and no delete, in either layer: no grant and no policy.

-- ---------------------------------------------------------------------------
-- 6. The analytics dashboard's leaderboard, rewritten BEFORE the table it used
--    to join is dropped. This function has a string body, so Postgres records
--    no dependency on the tables it reads and the drop below would succeed in
--    silence, leaving the dashboard raising "relation does not exist" at every
--    load. Inside one transaction the window is zero; the order is here so the
--    file stays correct if it is ever applied by hand in pieces.
--
--    The rewrite is also simpler than what it replaces. Attributing a visit to
--    a creator used to mean joining the feeds table and then the projects table
--    through a slug. Now the project carries the feed URL, so it is one join,
--    and it works for every creator rather than only the followed ones.

create or replace function everything_creator_visits(window_days int default null)
returns table (creator text, visits bigint, processed bigint, notes bigint, errored bigint)
language sql
stable
security definer
set search_path = public
as $$
  with visit as (
    select
      v.item_id,
      v.url,
      coalesce(
        nullif(regexp_replace(v.feed_url, '/+$', ''), ''),
        case
          when v.url ~* '^https?://(?!(www|open)\.)[\w-]+\.substack\.com/'
          then 'https://' || lower((regexp_match(v.url, '^https?://([\w-]+)\.substack\.com/', 'i'))[1]) || '.substack.com'
        end
      ) as feed_url
    from everything_link_visits v
    where window_days is null or v.visited_at >= now() - make_interval(days => window_days)
  ),
  attributed as (
    select
      coalesce(item_project.id, feed_project.id) as project_id,
      coalesce(
        item_project.name,
        feed_project.name,
        case
          when visit.feed_url is not null then regexp_replace(visit.feed_url, '^https?://(www\.)?', '')
          else regexp_replace(visit.url, '^https?://(www\.)?([^/]+).*$', '\2')
        end
      ) as creator
    from visit
    left join everything_items i on i.id = visit.item_id
    left join everything_projects item_project on item_project.id = i.project_id
    left join everything_projects feed_project
      on visit.feed_url is not null
     and lower(feed_project.feed_url) = lower(visit.feed_url)
  ),
  visit_counts as (
    select creator, max(project_id::text)::uuid as project_id, count(*) as visits
    from attributed
    group by creator
  ),
  item_stats as (
    select
      i.project_id,
      count(*) filter (where i.status = 'done') as processed,
      count(*) filter (where i.status = 'error') as errored
    from everything_items i
    group by i.project_id
  ),
  note_counts as (
    select i.project_id, count(*) as notes
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    join everything_items i on i.id = c.item_id
    group by i.project_id
  )
  select
    vc.creator,
    vc.visits,
    coalesce(s.processed, 0) as processed,
    coalesce(nc.notes, 0) as notes,
    coalesce(s.errored, 0) as errored
  from visit_counts vc
  left join item_stats s on s.project_id = vc.project_id
  left join note_counts nc on nc.project_id = vc.project_id
  order by vc.visits desc, vc.creator
$$;

revoke all on function everything_creator_visits(int) from public;
grant execute on function everything_creator_visits(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The old tables. No cascade: an unexpected dependency should abort this
--    migration rather than be dragged along with it.

drop table everything_follow_requests;
drop table everything_followed_feeds;

-- ---------------------------------------------------------------------------
-- 8. A view under the old name, for the extensions already installed in
--    people's browsers. They query everything_followed_feeds by name to decide
--    whether to offer the button, and they cannot be updated in step with this
--    migration. Without the view every one of them reads the error as "we
--    follow nobody" and shows the button on every author until its user
--    updates. security_invoker makes the view obey the base table's own policy
--    and column grants, so it exposes nothing new. A later migration drops it.

create view everything_followed_feeds
  with (security_invoker = true)
  as select feed_url from everything_projects where priority_until > now();

grant select on everything_followed_feeds to anon, authenticated;

comment on view everything_followed_feeds is
  'Compatibility shim for extension versions shipped before GOO-107. Drop once those versions are gone.';
