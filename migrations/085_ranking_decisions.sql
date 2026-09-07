-- One row per candidate note at submit time: which policy ran, how every scorer
-- scored it, what the window looked like, and what we did with it. The bar
-- (src/pipeline/capacity/window.ts) is a quantile over submit_score here.

create table if not exists ranking_decisions (
  id               bigserial primary key,
  decided_at       timestamptz not null default now(),
  pipeline_run_id  uuid,
  tweet_id         text,
  policy           text not null,
  scorer           text not null,             -- which scorer submit_score is under
  submit_score     double precision not null,
  scores           jsonb not null,            -- every scorer's submit score
  flags            integer,
  eval_score       double precision,
  decision         text not null,             -- submitted | below_bar | explored | daily_limit_reached | expired | error | dry_run | backfill:<outcome_reason>
  bar              double precision,
  cap              integer,
  cap_source       text,
  used_24h         integer,
  remaining        integer
);

create index if not exists ranking_decisions_decided_at_idx on ranking_decisions (decided_at desc);
create index if not exists ranking_decisions_scorer_decided_at_idx on ranking_decisions (scorer, decided_at desc);

alter table ranking_decisions enable row level security;
