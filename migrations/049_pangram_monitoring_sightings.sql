-- Dedup ledger for the XXL-feed Pangram AI-detection pre-pass.
-- One row per tweet we've run through Pangram, so a viral long-form post is
-- checked exactly once (not re-classified every run). Disjoint from the regular
-- skip logic (notes / pipeline_runs), so a Pangram check never makes the regular
-- pipeline skip a post. Mirrors misinfo_monitoring_sightings (migration 043).

create table pangram_monitoring_sightings (
  tweet_id         text primary key,
  feed_size        text,
  impression_count bigint,
  author_name      text,
  prediction_short text not null,        -- Pangram verdict: AI / AI-Assisted / Human / Mixed
  fraction_ai      real,
  is_ai            boolean not null,      -- prediction_short == 'AI' (the ones we note)
  checked_at       timestamptz not null default now(),
  processed_run_id uuid references pipeline_runs(id)  -- set for AI posts that became a note candidate
);
