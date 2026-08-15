-- Note requests become real queue input (GOO-8), readers can ask us to follow
-- a blog or channel (GOO-10), and the queue gets priority tiers plus the
-- bookkeeping for a daily spend cap (GOO-12).

-- ---------------------------------------------------------------------------
-- 1. everything_note_requests grows from a write-only inbox into a consumable
--    queue feed. The pipeline's request consumer reads pending rows with the
--    service key, turns each into an everything_items queue entry, and records
--    what happened on the request row itself.

alter table everything_note_requests
  add column page_text text check (page_text is null or char_length(page_text) <= 500000),
  add column status text not null default 'pending'
    check (status in ('pending', 'enqueued', 'done', 'skipped', 'error')),
  add column status_reason text,
  add column item_id uuid references everything_items (id);

comment on column everything_note_requests.page_text is
  'Body text of the page, captured by the extension at request time. It lets the pipeline fact-check pages it cannot fetch from CI.';
comment on column everything_note_requests.status is
  'pending = waiting for the consumer; enqueued = became a queue entry; done = the page was already checked; skipped/error = not consumable, see status_reason.';

-- Requested YouTube videos and web pages that belong to no publication we can
-- name are grouped under this catch-all project, the way write-anywhere pages
-- live under 'web'. A requested Substack post gets a project named after its
-- publication instead.
insert into everything_projects (slug, name, description)
values ('requested', 'Requested by readers', 'Pages readers asked us to check through the browser extension')
on conflict (slug) do nothing;

-- Clients still only insert, and only untouched rows: the consumer columns are
-- pinned to their defaults so a crafted client cannot park a request in a
-- consumed-looking state.
drop policy note_requests_insert on everything_note_requests;
create policy note_requests_insert on everything_note_requests
  for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and status = 'pending' and item_id is null);

-- ---------------------------------------------------------------------------
-- 2. Follow requests: a reader asks us to keep a whole Substack publication or
--    YouTube channel fact-checked. Write-only inbox, same pattern as note
--    requests. The consumer validates the feed and promotes it into
--    everything_followed_feeds.

create table everything_follow_requests (
  id uuid primary key default gen_random_uuid(),
  feed_type text not null check (feed_type in ('substack', 'youtube')),
  feed_url text not null check (char_length(feed_url) <= 2048),
  title text not null default '' check (char_length(title) <= 512),
  user_id uuid references auth.users (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'skipped', 'error')),
  status_reason text,
  created_at timestamptz not null default now()
);

alter table everything_follow_requests enable row level security;

grant insert on everything_follow_requests to anon, authenticated;
create policy follow_requests_insert on everything_follow_requests
  for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and status = 'pending');

-- The feeds we actually follow. Service-key only: the consumer writes it, the
-- auto-enqueue reads it alongside the hardcoded priority feeds. A Substack feed
-- is stored in its *.substack.com form, the only shape the RSS relay accepts.
create table everything_followed_feeds (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null,
  feed_type text not null check (feed_type in ('substack', 'youtube')),
  feed_url text not null unique,
  created_at timestamptz not null default now()
);

alter table everything_followed_feeds enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Queue priority. 2 = explicitly requested by a reader, 1 = post from a
--    followed feed, 0 = the curated backlog. The worker takes the highest tier
--    first and the newest published content within a tier.

alter table everything_items add column priority smallint not null default 0;

create index everything_items_queue_idx
  on everything_items (priority desc, published_at desc nulls first, created_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- 4. Daily spend. The worker sums today's LLM cost before it takes on more
--    work. The sum runs in the database, because PostgREST would otherwise cap
--    a row fetch at 1000 rows and quietly undercount.

create index everything_pipeline_runs_created_at_idx
  on everything_pipeline_runs (created_at);

create or replace function everything_cost_since(since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost), 0) from everything_pipeline_runs where created_at >= since;
$$;

revoke execute on function everything_cost_since(timestamptz) from public, anon, authenticated;
