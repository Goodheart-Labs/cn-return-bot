-- Checks for migration 207. The first check reads nothing and changes nothing,
-- so it can also run on prod after the migration. The rest write rows and run
-- only against 207_donations_priced_by_the_database.fixture.sql (the commands
-- are at the top of the fixture). Every value should be true.
create temp table result (name text, ok boolean);
grant all on result to anon, authenticated, service_role;

-- The formula gives, to the cent, what donationPair() in the TypeScript port
-- gave at the new rate on 2026-11-26. Columns: the tally before the vote
-- (helpful, somewhat helpful, not helpful), the vote, and the two amounts.
insert into result
select 'pair_matches_typescript_port', count(*) = 72 and bool_and(p.if_helpful = e.if_helpful and p.if_not_helpful = e.if_not_helpful)
  from (values
    (0, 0, 0, 1, 1.03, 0.08),
    (0, 0, 0, 0, 0.81, 0.32),
    (0, 0, 0, -1, 0.18, 0.66),
    (0, 0, 1, 1, 0.94, 0.08),
    (0, 0, 1, 0, 0.68, 0.25),
    (0, 0, 1, -1, 0.10, 0.44),
    (0, 0, 2, 1, 0.82, 0.11),
    (0, 0, 2, 0, 0.55, 0.21),
    (0, 0, 2, -1, 0.08, 0.31),
    (0, 1, 0, 1, 0.92, 0.08),
    (0, 1, 0, 0, 0.77, 0.32),
    (0, 1, 0, -1, 0.23, 0.78),
    (0, 1, 1, 1, 0.91, 0.08),
    (0, 1, 1, 0, 0.71, 0.28),
    (0, 1, 1, -1, 0.15, 0.57),
    (0, 1, 2, 1, 0.83, 0.08),
    (0, 1, 2, 0, 0.59, 0.22),
    (0, 1, 2, -1, 0.08, 0.39),
    (1, 0, 0, 1, 0.79, 0.08),
    (1, 0, 0, 0, 0.69, 0.31),
    (1, 0, 0, -1, 0.27, 0.84),
    (1, 0, 1, 1, 0.85, 0.08),
    (1, 0, 1, 0, 0.70, 0.29),
    (1, 0, 1, -1, 0.20, 0.67),
    (1, 0, 2, 1, 0.83, 0.08),
    (1, 0, 2, 0, 0.63, 0.25),
    (1, 0, 2, -1, 0.12, 0.50),
    (1, 1, 0, 1, 0.66, 0.08),
    (1, 1, 0, 0, 0.60, 0.28),
    (1, 1, 0, -1, 0.29, 0.84),
    (1, 1, 1, 1, 0.76, 0.08),
    (1, 1, 1, 0, 0.65, 0.29),
    (1, 1, 1, -1, 0.24, 0.74),
    (1, 1, 2, 1, 0.79, 0.08),
    (1, 1, 2, 0, 0.63, 0.27),
    (1, 1, 2, -1, 0.17, 0.59),
    (2, 0, 0, 1, 0.54, 0.08),
    (2, 0, 0, 0, 0.51, 0.25),
    (2, 0, 0, -1, 0.29, 0.80),
    (2, 0, 1, 1, 0.66, 0.08),
    (2, 0, 1, 0, 0.59, 0.28),
    (2, 0, 1, -1, 0.27, 0.77),
    (2, 0, 2, 1, 0.73, 0.08),
    (2, 0, 2, 0, 0.61, 0.27),
    (2, 0, 2, -1, 0.21, 0.66),
    (2, 1, 0, 1, 0.44, 0.08),
    (2, 1, 0, 0, 0.42, 0.22),
    (2, 1, 0, -1, 0.28, 0.73),
    (2, 1, 1, 1, 0.57, 0.08),
    (2, 1, 1, 0, 0.52, 0.26),
    (2, 1, 1, -1, 0.28, 0.75),
    (2, 1, 2, 1, 0.66, 0.08),
    (2, 1, 2, 0, 0.57, 0.27),
    (2, 1, 2, -1, 0.25, 0.70),
    (3, 0, 0, 1, 0.36, 0.08),
    (3, 0, 0, 0, 0.35, 0.19),
    (3, 0, 0, -1, 0.25, 0.64),
    (3, 0, 1, 1, 0.48, 0.08),
    (3, 0, 1, 0, 0.45, 0.23),
    (3, 0, 1, -1, 0.28, 0.71),
    (3, 0, 2, 1, 0.58, 0.08),
    (3, 0, 2, 0, 0.52, 0.26),
    (3, 0, 2, -1, 0.27, 0.71),
    (3, 1, 0, 1, 0.29, 0.08),
    (3, 1, 0, 0, 0.28, 0.17),
    (3, 1, 0, -1, 0.23, 0.55),
    (3, 1, 1, 1, 0.40, 0.08),
    (3, 1, 1, 0, 0.38, 0.21),
    (3, 1, 1, -1, 0.27, 0.65),
    (3, 1, 2, 1, 0.50, 0.08),
    (3, 1, 2, 0, 0.47, 0.24),
    (3, 1, 2, -1, 0.28, 0.69)
  ) as e (h, s, n, vote, if_helpful, if_not_helpful),
  lateral everything_donation_pair(e.h, e.s, e.n, e.vote) p;

-- The client's upsert, exactly as supabase-js sends it.
create function pg_temp.save_donation(vote uuid, charity text) returns void language sql as $$
  insert into everything_donations (vote_id, charity) values (vote, charity)
  on conflict (vote_id) do update set vote_id = excluded.vote_id, charity = excluded.charity
$$;
-- The upsert an extension version from before this migration sends.
create function pg_temp.save_donation_old_client(vote uuid, charity text, if_helpful numeric, if_not_helpful numeric) returns void language sql as $$
  insert into everything_donations (vote_id, charity, amount_if_helpful, amount_if_not_helpful) values (vote, charity, if_helpful, if_not_helpful)
  on conflict (vote_id) do update set vote_id = excluded.vote_id, charity = excluded.charity,
    amount_if_helpful = excluded.amount_if_helpful, amount_if_not_helpful = excluded.amount_if_not_helpful
$$;
create function pg_temp.amounts(vote uuid) returns numeric[] language sql as $$
  select array[amount_if_helpful, amount_if_not_helpful] from everything_donations where vote_id = vote
$$;
create function pg_temp.expected(h int, s int, n int, vote int) returns numeric[] language sql as $$
  select array[p.if_helpful, p.if_not_helpful] from everything_donation_pair(h, s, n, vote) p
$$;
create function pg_temp.act_as(voter uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', voter, 'role', 'authenticated')::text, false)
$$;

-- The donation minted before the migration keeps its old-rate amounts, also
-- when its voter redirects it to another charity.
insert into result select 'old_row_priced_for_its_vote', priced_vote = 1 from everything_donations where vote_id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
update everything_donations set charity = 'ace' where vote_id = '00000000-0000-0000-0000-0000000000f1';
reset role;
insert into result select 'old_row_keeps_amounts_on_charity_change', pg_temp.amounts('00000000-0000-0000-0000-0000000000f1') = array[3.08, 0.25];

-- The author's automatic Helpful vote is priced against an empty tally.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.save_donation('00000000-0000-0000-0000-0000000000f0', 'give_directly');
reset role;
insert into result select 'self_vote_priced_on_empty_tally',
  pg_temp.amounts('00000000-0000-0000-0000-0000000000f0') = array[1.03, 0.08] and pg_temp.expected(0, 0, 0, 1) = array[1.03, 0.08];

-- A reader's Helpful vote on that note leaves out the author's vote.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
insert into everything_votes (id, note_id, voter_id, vote) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', 1);
select pg_temp.save_donation('00000000-0000-0000-0000-0000000000f2', 'give_directly');
reset role;
insert into result select 'first_reader_vote_leaves_out_author', pg_temp.amounts('00000000-0000-0000-0000-0000000000f2') = pg_temp.expected(0, 0, 0, 1);

-- An old extension sends its own amounts. The trigger replaces them.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
set role authenticated;
insert into everything_votes (id, note_id, voter_id, vote) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000d', 1);
select pg_temp.save_donation_old_client('00000000-0000-0000-0000-0000000000f3', 'give_directly', 9.99, 9.99);
select pg_temp.save_donation_old_client('00000000-0000-0000-0000-0000000000f3', 'givewell', 9.99, 9.99);
reset role;
insert into result select 'old_client_amounts_replaced', pg_temp.amounts('00000000-0000-0000-0000-0000000000f3') = pg_temp.expected(1, 0, 0, 1);

-- Changing the vote prices the donation again, against the tally without it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
update everything_votes set vote = -1 where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.save_donation('00000000-0000-0000-0000-0000000000f2', 'give_directly');
reset role;
insert into result select 'changed_vote_priced_again',
  pg_temp.amounts('00000000-0000-0000-0000-0000000000f2') = pg_temp.expected(1, 0, 0, -1)
  and (select priced_vote = -1 from everything_donations where vote_id = '00000000-0000-0000-0000-0000000000f2');

-- A paid donation is never priced again, even when its vote changes.
update everything_donations set amount_usd = 0.94 where vote_id = '00000000-0000-0000-0000-0000000000f2';
insert into result select 'payout_keeps_amounts', pg_temp.amounts('00000000-0000-0000-0000-0000000000f2') = pg_temp.expected(1, 0, 0, -1);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
update everything_votes set vote = 1 where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.save_donation('00000000-0000-0000-0000-0000000000f2', 'give_directly');
reset role;
insert into result select 'paid_row_not_priced_again', pg_temp.amounts('00000000-0000-0000-0000-0000000000f2') = pg_temp.expected(1, 0, 0, -1);

-- A reader cannot write the priced vote or call the formula.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
do $$
begin
  update everything_donations set priced_vote = 0 where vote_id = '00000000-0000-0000-0000-0000000000f2';
  insert into result values ('reader_cannot_write_priced_vote', false);
exception when insufficient_privilege then
  insert into result values ('reader_cannot_write_priced_vote', true);
end $$;
do $$
begin
  perform everything_donation_pair(0, 0, 0, 1);
  insert into result values ('reader_cannot_call_formula', false);
exception when insufficient_privilege then
  insert into result values ('reader_cannot_call_formula', true);
end $$;
reset role;

select * from result order by ok, name;
