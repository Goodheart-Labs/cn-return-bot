-- Total LLM cost (USD) for the run, including tool-call costs.
-- Populated live from logs->'costs'->'total'->>'cost'; backfilled for older
-- rows that stored cost under logs->'<bot>'->'costs'->'total'->>'cost'.
-- NULL means no cost data was captured (e.g. pre-cost-tracker runs or runs
-- that crashed before aggregateAndLogCosts ran).
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS cost NUMERIC(10, 6);
