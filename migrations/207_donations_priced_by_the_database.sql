-- The database prices every vote donation (GOO-890).
--
-- Every vote on a note mints a donation with two amounts: one paid if the note
-- ends up rated helpful, one if it ends up rated not helpful. Until now the
-- browser computed both amounts with donationPair() in
-- src/everything-core/donationScoring.ts and wrote them into the row. So a
-- change to the formula reached extension users only once they installed a new
-- extension version, and any client could write any amount up to the 13 USD
-- that migration 114 allows.
--
-- From now on a trigger computes the amounts whenever a donation row is
-- written, and it ignores the amounts the client sent. The client still
-- decides when a donation is minted and which charity it goes to. Extension
-- versions from before this migration keep sending their own amounts, so the
-- columns stay writable for them, but the trigger replaces those amounts. Such
-- an old version shows its own old-rate amounts in its donation notice, while
-- the row holds the new ones.
--
-- The same change lowers every new amount by a factor of 3 (Jim, 2026-11-26).
-- Rows minted before keep their amounts.
--
-- Run as postgres (SQL editor or the management API), on local and prod.
-- Apply it before the website change that stops sending amounts is deployed.


-- 1. The formula.
--
-- What a vote is worth rests on the model of a note's latent quality that
-- everything_probability_helpful (migration 141) computes. As the votes pin
-- that quality down, each new vote moves the belief less, so a vote's donation
-- shrinks on its own. There is no decay parameter anywhere.
--
-- The amounts come from the Brier rule. That rule is proper, which means voting
-- honestly maximises your expected donation. It is also bounded. Once the crowd
-- has converged, the payout goes to zero on both sides, so a late vote is a
-- low-stakes click rather than a big bet at long odds.
--
-- Every amount is lifted by a base, which is the stake still on the table: the
-- worst score drop any vote could suffer from the current position, plus a
-- small tip. The base depends only on the tally the voter walked into, never on
-- how they vote, so it does not change which vote pays best.
--
-- The reference model, its derivation and the rejected alternatives are in
-- src/scripts_jim/2026_07_21_donation_decay/. This function is its port, and
-- the verify file checks it against amounts the earlier TypeScript port gave.
create function everything_donation_pair(
  helpful int, somewhat_helpful int, not_helpful int, vote int,
  out if_helpful numeric, out if_not_helpful numeric)
language plpgsql immutable parallel safe set search_path = public as $$
declare
  -- Jim raised this from 5 to 6.25 on 2026-07-21, which lifted every amount by
  -- 25%. On 2026-11-26 he lowered every new amount by a factor of 3, so this
  -- and the tip are both divided by 3. Dividing both keeps the shape of the
  -- decay and makes every amount exactly a third of what it was before
  -- rounding to cents.
  dollars_per_score_unit constant float8 := 6.25 / 3;
  -- The floor under every amount, so that voting on a fully converged note
  -- still pays for the click. It shows as 0.08 USD.
  participation_tip constant float8 := 0.25 / 3;
  p_before float8 := public.everything_probability_helpful(helpful, somewhat_helpful, not_helpful);
  p_after float8;
  p_other float8;
  worst_drop float8 := 0;
  base float8;
  other_vote int;
begin
  -- The Brier score is 1 - (1 - p)^2 if the note settles helpful and 1 - p^2
  -- if it settles not helpful.
  foreach other_vote in array array[1, 0, -1] loop
    p_other := public.everything_probability_helpful(
      helpful + (other_vote = 1)::int, somewhat_helpful + (other_vote = 0)::int, not_helpful + (other_vote = -1)::int);
    worst_drop := greatest(worst_drop,
      (1 - (1 - p_before) ^ 2) - (1 - (1 - p_other) ^ 2),
      (1 - p_before ^ 2) - (1 - p_other ^ 2));
  end loop;
  base := participation_tip + dollars_per_score_unit * worst_drop;
  p_after := public.everything_probability_helpful(
    helpful + (vote = 1)::int, somewhat_helpful + (vote = 0)::int, not_helpful + (vote = -1)::int);
  if_helpful := round((base + dollars_per_score_unit * ((1 - p_before) ^ 2 - (1 - p_after) ^ 2))::numeric, 2);
  if_not_helpful := round((base + dollars_per_score_unit * (p_before ^ 2 - p_after ^ 2))::numeric, 2);
end $$;


-- 2. Which vote a row's amounts were priced for.
--
-- A donation row is written again when its voter changes their vote, when they
-- redirect it to another charity, and when the team marks it as paid. Only the
-- first of these may change the amounts. This column tells them apart: the
-- amounts are priced again only when the vote no longer matches it. Every
-- existing row was priced for the vote it holds now, because the client wrote
-- the pair right after each vote. The trigger fills the column on every
-- write. It has no not-null constraint only because the generated frontend
-- types would then demand it in every insert the client sends.
alter table everything_donations add column priced_vote smallint;
update everything_donations d set priced_vote = v.vote from everything_votes v where v.id = d.vote_id;
comment on column everything_donations.priced_vote is
  'The vote the amounts were priced for (migration 207). The trigger prices the row again when the vote changes.';


-- 3. The trigger.
--
-- The vote is priced against the note's tally without this vote and without
-- the author's own automatic Helpful vote, which is how the browser priced it.
-- The note's counters already include this vote, because the vote row is
-- written first and a trigger on everything_votes updates the counters. A row
-- that was already paid out is never priced again.
create function everything_donations_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cast_vote everything_votes;
  note everything_notes;
  pair record;
begin
  select * into cast_vote from everything_votes where id = new.vote_id;
  if tg_op = 'UPDATE' and (old.priced_vote = cast_vote.vote or old.amount_usd is not null) then
    new.amount_if_helpful := old.amount_if_helpful;
    new.amount_if_not_helpful := old.amount_if_not_helpful;
    new.priced_vote := old.priced_vote;
    return new;
  end if;
  select * into note from everything_notes where id = cast_vote.note_id;
  pair := public.everything_donation_pair(
    greatest(note.helpful_count - (note.author_id is not null)::int - (cast_vote.vote = 1)::int, 0),
    greatest(note.somewhat_helpful_count - (cast_vote.vote = 0)::int, 0),
    greatest(note.not_helpful_count - (cast_vote.vote = -1)::int, 0),
    cast_vote.vote);
  new.amount_if_helpful := pair.if_helpful;
  new.amount_if_not_helpful := pair.if_not_helpful;
  new.priced_vote := cast_vote.vote;
  return new;
end $$;

create trigger everything_donations_price
  before insert or update on everything_donations
  for each row execute function everything_donations_price();


-- Only the trigger calls these. Supabase grants every new function in the
-- public schema to anon and authenticated by default.
revoke all on function everything_donation_pair(int, int, int, int) from public, anon, authenticated;
revoke all on function everything_donations_price() from public, anon, authenticated;

notify pgrst, 'reload schema';
