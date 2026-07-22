-- ---------------------------------------------------------------------------
-- Common Notes: the rating leaderboard becomes opt-in. 062 listed every voter
-- by default and let them hide themselves; now nobody is listed until they
-- explicitly tick "show me on the leaderboard".
--
-- Existing prefs rows are left alone: under 062 a row with true meant the user
-- toggled themselves back on, which is the same explicit consent opt-in wants.
-- ---------------------------------------------------------------------------

alter table everything_rater_prefs
  alter column show_on_leaderboard set default false;

-- Same aggregation as 062, but a voter needs a prefs row saying true to appear
-- (inner join instead of coalesce-to-visible on a missing row).
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
  join everything_rater_prefs p on p.user_id = v.voter_id
  where p.show_on_leaderboard
  group by u.id
  order by rating_count desc, name asc
$$;

revoke all on function everything_leaderboard() from public;
grant execute on function everything_leaderboard() to anon, authenticated;
