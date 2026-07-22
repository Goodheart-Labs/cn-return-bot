-- ---------------------------------------------------------------------------
-- Common Notes: rating leaderboard. Ranks people by how many notes they've
-- rated (one everything_votes row per note-per-user, so count(*) per voter is
-- their rating count). The public SPA runs on the anon key, which cannot read
-- everything_votes (owner-only RLS) or auth.users — so a security-definer RPC
-- does the aggregation + name resolution server-side and is granted to anon.
-- A per-user prefs row lets anyone hide themselves from the board (opt-out).
-- ---------------------------------------------------------------------------

-- Opt-out flag, keyed to the auth user. Shown by default; a row appears only
-- once someone toggles their visibility.
create table everything_rater_prefs (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  show_on_leaderboard boolean not null default true,
  updated_at          timestamptz not null default now()
);

alter table everything_rater_prefs enable row level security;
grant select, insert, update on everything_rater_prefs to authenticated;  -- anon: no access

create policy own_prefs_select on everything_rater_prefs
  for select to authenticated using (user_id = auth.uid());
create policy own_prefs_insert on everything_rater_prefs
  for insert to authenticated with check (user_id = auth.uid());
create policy own_prefs_update on everything_rater_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Aggregated leaderboard. security definer so it can read auth.users + every
-- voter's rows; returns only a display name + count (never the auth uuid or
-- email). The name mirrors displayName() in the SPA (X handle → full name →
-- email local part). Opted-out voters are dropped entirely.
create or replace function everything_leaderboard()
returns table (name text, rating_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(
      u.raw_user_meta_data->>'user_name',
      u.raw_user_meta_data->>'full_name',
      split_part(u.email::text, '@', 1),
      'anonymous'
    ) as name,
    count(*) as rating_count
  from everything_votes v
  join auth.users u on u.id = v.voter_id
  left join everything_rater_prefs p on p.user_id = v.voter_id
  where coalesce(p.show_on_leaderboard, true)
  group by u.id
  order by rating_count desc, name asc
$$;

-- 050's blanket revoke + altered default privileges strip execute from
-- anon/authenticated, so grant it back explicitly.
revoke all on function everything_leaderboard() from public;
grant execute on function everything_leaderboard() to anon, authenticated;
