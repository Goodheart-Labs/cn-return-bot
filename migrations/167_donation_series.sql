-- The vote donations over time, for the admin dashboard's Donations section
-- (GOO-718).
--
-- Every vote on someone else's note mints a donation with two frozen amounts:
-- one paid if the note ends up rated helpful, one if it ends up rated not
-- helpful. A donation is owed once its note is rated, which
-- everything_note_status decides from the note's stored p_helpful, the same
-- rule as noteStatus in src/everything-core/noteScore.ts and the payout script
-- src/everything/donationPayout.ts. A donation counts as paid once
-- amount_usd holds the amount that was paid.
--
-- The function returns one row per UTC day, charity and team flag, with the
-- amount paid and the amount owed but not paid yet. The day is the day the
-- vote was first cast, because a changed vote keeps its donation row and its
-- created_at. The browser adds the days up into running totals.
--
-- The amounts use each note's rating of today, not its rating on that day.
-- The vote history that could rebuild older ratings only starts on
-- 2026-10-06, so a day's running total means "the donations of the votes cast
-- up to that day, as far as they are owed now". When a note gets rated later,
-- the earlier days rise too.
--
-- A team vote is a vote by an account whose email is in everything_admins,
-- the same accounts src/everything/teamAccounts.ts finds.
--
-- Only admins may call it, because single days can be small enough to point
-- at one voter's donations.

create function everything_donation_series()
returns table (day date, charity text, team_vote boolean, paid numeric, outstanding numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not everything_is_admin() then raise exception 'Only admins can read the donations'; end if;
  return query
  with team as (
    select u.id from auth.users u join everything_admins a on a.email = lower(u.email)
  ),
  priced as (
    select (d.created_at at time zone 'utc')::date as day,
           d.charity,
           v.voter_id in (select id from team) as team_vote,
           d.amount_usd,
           case everything_note_status(n.p_helpful)
             when 'helpful' then d.amount_if_helpful
             when 'not_helpful' then d.amount_if_not_helpful
           end as owed
      from everything_donations d
      join everything_votes v on v.id = d.vote_id
      join everything_notes n on n.id = v.note_id
  )
  select p.day, p.charity, p.team_vote,
         coalesce(sum(p.amount_usd), 0) as paid,
         coalesce(sum(p.owed) filter (where p.amount_usd is null), 0) as outstanding
    from priced p
   group by p.day, p.charity, p.team_vote
   order by p.day, p.charity, p.team_vote;
end;
$$;

revoke execute on function everything_donation_series() from public;
grant execute on function everything_donation_series() to authenticated;

notify pgrst, 'reload schema';
