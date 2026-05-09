# 2026-05-09 — Candidate-rate drop investigation (runbook)

## What this folder is

Canonical "the candidate rate dropped, what broke?" runbook. Mirrors the
[outcome_reason taxonomy in DATABASE.md](../../../docs/DATABASE.md#pipeline_runs--every-processing-attempt).
After the error-handling refactor (PR `refactor/error-handling`), failure
rows in `pipeline_runs` are guaranteed to have non-NULL `error_message`,
populated `logs->'error'->>'stack'`, and an `outcome_reason` from a fixed
enum — so these scripts give clean buckets without the "23 of 93 rows
have null messages" headaches we used to see.

## Scripts (run from repo root)

| Script | What it answers |
|---|---|
| `01_outcome_distribution.py` | Daily outcome breakdown for the last 14 days + outcome_reason breakdown for the last 3 days vs the prior 3-day baseline. |
| `02_failed_runs.py` | All `outcome=failed` rows in the last 7 days, grouped by outcome_reason / A/B variant / error fingerprint, with sample stack traces. |

## Sibling investigations

When `02_failed_runs.py` highlights specific outcome_reasons:

| outcome_reason | Where to drill in |
|---|---|
| `unfetchable_sources` | `../2026_05_09_broken_search_variants/` — figures out which variants cite URLs that can't be fetched. |
| `model_output_invalid` | `../2026_05_09_json_parse_failures/` — buckets by provider and tests whether `response_format` is actually honored. |
| `bot_error` | Read the stack trace; grep the codebase. |
| `not_completed` | Sweeper marked it failed. Look at the row's `created_at` to find the window when the pipeline crashed. |
