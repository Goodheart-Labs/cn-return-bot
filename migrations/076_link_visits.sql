-- Visit counts for covered pages, recorded by the browser extension on
-- Substack, YouTube, and LessWrong. One row per page view of a page that has
-- an everything_items row. The extension decides on-device, against its local
-- coverage list, whether a page is one of ours before anything is sent, so
-- browsing pages we do not cover never reaches the database. Rows are
-- anonymous on purpose: no user id, no referrer, just the item's URL and the
-- time. Nothing in the app reads this table; the team counts visits per URL
-- in SQL.

create table everything_link_visits (
  id uuid primary key default gen_random_uuid(),
  url text not null check (char_length(url) <= 2048),
  item_id uuid references everything_items (id) on delete set null,
  visited_at timestamptz not null default now()
);

create index everything_link_visits_url_idx on everything_link_visits (url);

alter table everything_link_visits enable row level security;

-- Insert-only: table grant (migration 050 revoked client defaults) plus the
-- RLS policy; no select/update/delete for clients.
grant insert on everything_link_visits to anon, authenticated;
create policy link_visits_insert on everything_link_visits
  for insert to anon, authenticated
  with check (true);
