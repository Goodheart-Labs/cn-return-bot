-- Common Notes: three-way helpfulness voting — helpful (1), somewhat helpful (0),
-- not helpful (-1) — matching X Community Notes' rating scale (somewhat carries
-- 0.5 weight at scoring/display time, as in review-dashboard's underwater ratio).
--
-- Additive and backward compatible: existing ±1 rows keep their meaning, and a
-- deployed two-way frontend can keep casting ±1 votes while this rolls out.
--
-- Run as postgres (SQL editor / psql), on local and prod.

-- Widen the allowed vote values. The constraint was created inline on the vote
-- column in 050, so it carries Postgres's default name.
alter table everything_votes drop constraint if exists everything_votes_vote_check;
alter table everything_votes add constraint everything_votes_vote_check check (vote in (1, 0, -1));

-- Counter for the middle bucket, named after the same column in the canonical
-- X notes tables (helpful_count / somewhat_helpful_count / not_helpful_count).
alter table everything_notes add column somewhat_helpful_count int not null default 0;

-- Fold the third bucket into the counter trigger. Same shape as 050: every
-- vote change becomes one everything_notes UPDATE, which is also the realtime
-- event the frontend subscribes to.
create or replace function everything_apply_vote()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_notes set
      helpful_count          = helpful_count          - (old.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count - (old.vote = 0)::int,
      not_helpful_count      = not_helpful_count      - (old.vote = -1)::int
    where id = old.note_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_notes set
      helpful_count          = helpful_count          + (new.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count + (new.vote = 0)::int,
      not_helpful_count      = not_helpful_count      + (new.vote = -1)::int
    where id = new.note_id;
  end if;
  return coalesce(new, old);
end $$;
