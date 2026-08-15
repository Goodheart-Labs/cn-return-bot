# Pipeline cost distribution (2026-08-15)

Data: all 2379 rows of `everything_pipeline_runs` (prod), which starts on
2026-08-06 when migration 068 landed. "Post" = one `everything_items` row;
its cost is the sum of its claims' run costs.

Ticket: GOO-11. Run with `uv run src/scripts_jim/2026_08_15_pipeline_costs/main.py`
(`--local` for the local stack).

## Per-run (one fact-checked claim)

Median $0.09, mean $0.12, p95 $0.25, max $1.11. Cheap and tightly clustered —
cost variation lives almost entirely in how many claims a post produces, not
in individual runs.

## Per-post

| stat | USD |
|---|---|
| median | 2.26 |
| mean | 3.93 |
| p90 | 10.45 |
| p95 | 13.30 |
| max | 22.21 |

Right-skewed: half of the 72 posts cost under $2.30, but long Zvi AI
roundups (30–100+ claims) run $10–22. The top post ("Claude Opus 5 Is Highly
Capable, But Is No Mythos") cost $22.21.

## Daily spend vs a 50 EUR/day budget

50 EUR ≈ $58.50 (at 1.17 USD/EUR).

- The first two days (Aug 6–7) were the backfill catch-up: ~$98 and ~$107 —
  both over the proposed budget.
- Steady state since then: **$3–27/day, averaging ~$13/day** — the overall
  8-day average including the backfill is $35/day.
- 50 EUR/day gives roughly 2–4x headroom over steady state and covers about
  5 typical Zvi roundups or ~25 median posts per day.

**Conclusion: 50 EUR/day is comfortably sufficient for the current feed set;
even a single day's worst-case (several long roundups at once) fits. Only
bulk backfills would exceed it, and those are one-offs you'd schedule
deliberately.**
