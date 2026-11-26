-- A miniature of production for migration 207: notes with their vote
-- counters, votes, the donation ledger with its policies and grants, and the
-- rating model of migration 141. auth.uid() reads the same setting
-- PostgREST sets, so the verify file can act as a signed-in reader.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/207_donations_priced_by_the_database.fixture.sql
--   $PSQL --single-transaction -f migrations/207_donations_priced_by_the_database.sql
--   $PSQL -f migrations/207_donations_priced_by_the_database.verify.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

-- The rating model, copied from migration 141.
create function everything_log_gamma(x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  coefficients constant float8[] := array[
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z float8 := x - 1;
  series float8 := 0.99999999999980993;
  t float8;
begin
  -- The reflection formula keeps the series in its convergent range.
  if x < 0.5 then
    return ln(pi() / sin(pi() * x)) - public.everything_log_gamma(1 - x);
  end if;
  for i in 1..8 loop
    series := series + coefficients[i] / (z + i);
  end loop;
  t := z + 7.5;
  return 0.5 * ln(2 * pi()) + (z + 0.5) * ln(t) - t + ln(series);
end;
$$;

-- The continued fraction for the incomplete beta function. It converges
-- quickly when x is below (a + 1) / (a + b + 2).
create function everything_beta_continued_fraction(a float8, b float8, x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  max_iterations constant int := 300;
  relative_tolerance constant float8 := 3e-14;
  -- This value only guards against a division by zero.
  tiny constant float8 := 1e-300;
  c float8 := 1;
  d float8 := 1 - (a + b) * x / (a + 1);
  result float8;
  numerator float8;
  step float8;
begin
  if abs(d) < tiny then d := tiny; end if;
  d := 1 / d;
  result := d;
  for m in 1..max_iterations loop
    -- The even step of the recurrence.
    numerator := m * (b - m) * x / ((a - 1 + 2 * m) * (a + 2 * m));
    d := 1 + numerator * d;
    if abs(d) < tiny then d := tiny; end if;
    c := 1 + numerator / c;
    if abs(c) < tiny then c := tiny; end if;
    d := 1 / d;
    result := result * d * c;
    -- The odd step of the recurrence.
    numerator := -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 1 + 2 * m));
    d := 1 + numerator * d;
    if abs(d) < tiny then d := tiny; end if;
    c := 1 + numerator / c;
    if abs(c) < tiny then c := tiny; end if;
    d := 1 / d;
    step := d * c;
    result := result * step;
    exit when abs(step - 1) < relative_tolerance;
  end loop;
  return result;
end;
$$;

-- The regularized incomplete beta function I_x(a, b), which is the cumulative
-- distribution function of Beta(a, b).
create function everything_incomplete_beta(a float8, b float8, x float8) returns float8
language plpgsql immutable parallel safe as $$
declare
  front float8;
begin
  if x <= 0 then return 0; end if;
  if x >= 1 then return 1; end if;
  front := exp(public.everything_log_gamma(a + b) - public.everything_log_gamma(a) - public.everything_log_gamma(b) + a * ln(x) + b * ln(1 - x));
  -- On the far side the mirrored fraction converges faster.
  if x < (a + 1) / (a + b + 2) then
    return front * public.everything_beta_continued_fraction(a, b, x) / a;
  end if;
  return 1 - front * public.everything_beta_continued_fraction(b, a, 1 - x) / b;
end;
$$;

-- The chance that a note with these votes ends up rated helpful. The prior
-- weighs about five imagined votes, a Somewhat helpful vote counts as half a
-- Helpful vote, and 0.4 is X's bar for a helpful note.
create function everything_probability_helpful(helpful int, somewhat_helpful int, not_helpful int) returns float8
language sql immutable parallel safe as $$
  select 1 - public.everything_incomplete_beta(
    1.6806912990301406::float8 + helpful + 0.5 * somewhat_helpful,
    3.3193087009698594::float8 + not_helpful,
    0.4::float8);
$$;

create table everything_notes (
  id uuid primary key,
  author_id uuid,
  helpful_count int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count int not null default 0
);
grant select on everything_notes to anon, authenticated;

create table everything_votes (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references everything_notes (id),
  voter_id uuid not null,
  vote smallint not null check (vote in (-1, 0, 1)),
  platform text,
  unique (note_id, voter_id)
);
alter table everything_votes enable row level security;
grant select, insert, update, delete on everything_votes to authenticated;
create policy own_votes on everything_votes for all to authenticated
  using (voter_id = auth.uid()) with check (voter_id = auth.uid());

-- The counter trigger of migrations 050 and 051.
create function everything_votes_counter() returns trigger language plpgsql security definer as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_notes set
      helpful_count = helpful_count - (old.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count - (old.vote = 0)::int,
      not_helpful_count = not_helpful_count - (old.vote = -1)::int
     where id = old.note_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_notes set
      helpful_count = helpful_count + (new.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count + (new.vote = 0)::int,
      not_helpful_count = not_helpful_count + (new.vote = -1)::int
     where id = new.note_id;
  end if;
  return null;
end $$;
create trigger everything_votes_counter after insert or update or delete on everything_votes
  for each row execute function everything_votes_counter();

-- The ledger as migrations 059, 061 and 114 left it.
create table everything_donations (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null unique references everything_votes (id) on delete cascade,
  charity text not null check (charity in ('give_directly', 'givewell', 'ace', 'ea_ltff')),
  amount_usd numeric,
  amount_if_helpful numeric,
  amount_if_not_helpful numeric,
  created_at timestamptz not null default now(),
  constraint everything_donations_amount_range
    check (amount_if_helpful between 0 and 13 and amount_if_not_helpful between 0 and 13)
);
alter table everything_donations enable row level security;
grant select on everything_donations to authenticated;
grant insert (vote_id, charity, amount_if_helpful, amount_if_not_helpful) on everything_donations to authenticated;
grant update (vote_id, charity, amount_if_helpful, amount_if_not_helpful) on everything_donations to authenticated;
create policy own_donations_select on everything_donations for select to authenticated
  using (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));
create policy own_donations_insert on everything_donations for insert to authenticated
  with check (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));
create policy own_donations_update on everything_donations for update to authenticated
  using (exists (select 1 from everything_votes v where v.id = vote_id and v.voter_id = auth.uid()));

-- A note written by a reader, whose author has already voted Helpful on it,
-- and a note by Claude, which has no author. One vote from before the
-- migration already has its donation, priced by the browser at the old rate.
insert into everything_notes (id, author_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000e2', null);
insert into everything_votes (id, note_id, voter_id, vote) values
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 1),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000b', 1);
insert into everything_donations (vote_id, charity, amount_if_helpful, amount_if_not_helpful) values
  ('00000000-0000-0000-0000-0000000000f1', 'givewell', 3.08, 0.25);
