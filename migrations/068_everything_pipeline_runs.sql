-- Per-claim run records for the everything pipeline — the counterpart of
-- pipeline_runs for X tweets. Until now the fact-check of a claim (a full
-- simple-bot run: search + writer + verifier) discarded its tweet log and LLM
-- costs; only the terminal claim status survived. One row per checkClaim call,
-- written best-effort by src/everything/pipeline/checkClaims.ts.
--
-- Kept out of pipeline_runs on purpose: these runs have no tweet behind them,
-- and synthetic ids would pollute every analysis that joins runs to tweets.

create table everything_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references everything_claims(id) on delete cascade,
  bot_name text,
  outcome text,           -- processTweet outcome: candidate | filtered | failed | ...
  outcome_reason text,
  final_stage text,
  ab_test_picks jsonb,    -- forced picks the run used (bot, search, writer, verifier arms)
  bot_config jsonb,       -- full resolved BotConfig snapshot
  logs jsonb,             -- nested tweet log (search results, writer output, costs breakdown)
  cost numeric,           -- total LLM cost in USD (costs.total of the tweet log)
  created_at timestamptz not null default now()
);

create index everything_pipeline_runs_claim_id_idx on everything_pipeline_runs (claim_id);

-- Internal logs: no anon/authenticated access (migration 050 already revoked
-- default privileges; RLS with no policies keeps it service-key only).
alter table everything_pipeline_runs enable row level security;
