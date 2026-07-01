# Routine gap vs. note-outcome rate (Small vs Large feed)

**Question:** does the time gap between consecutive "create notes routine" runs relate to
the outcomes of the notes that routine submits?

Two outcome metrics, same setup:
- **helpful** — note ends up Currently-Rated-Helpful
- **lost** — note is "lost to a competitor" (the review-dashboard group)

## Method

- **Routine run** = a GitHub Actions "Create Notes Routine" invocation (there is no routine-run
  id in the DB; `pipeline_runs` is one row per tweet). `run_started_at` is the start time;
  runs never overlap (`concurrency: cancel-in-progress: false`).
- **x = elapsed_min** = minutes since the previous routine started.
- A note is binned to the routine whose `[start_i, start_{i+1})` window contains its
  `notes.submitted_at`.
- **Feed** of a note = `pipeline_runs.ab_test_picks->>'feed_size'` on its submitting run.
  Small = `{small}`, Large = `{large, xl, xxl}`. Analyzed separately.

### Outcome classification (matches the dashboard)

Each submitted note → one mutually-exclusive failure type, exactly per
`src/review-dashboard/src/lib/data.ts` `cnStatusToFailureType` (priority order):

1. `rated_helpful` — `cn_status == CURRENTLY_RATED_HELPFUL`
2. `rated_unhelpful` — `cn_status == CURRENTLY_RATED_NOT_HELPFUL`
3. **`lost_to_competitor`** — not helpful/unhelpful **AND** a competing note on the same tweet
   (`competing_notes.our_note_id = note_id`) has `current_status == CURRENTLY_RATED_HELPFUL`
4. `needs_more_ratings` — `cn_status == NEEDS_MORE_RATINGS`, no helpful competitor
5. `uncategorized` — `cn_status` null, no helpful competitor

Both metrics use the **same base** so they're directly comparable
(`base = rated_helpful + needs_more_ratings + lost_to_competitor`; unhelpful and bare-null
excluded, matching the original "leave out unhelpful"):

- `y_helpful = #rated_helpful      / base`
- `y_lost    = #lost_to_competitor / base`

`cn_status` and `competing_notes.current_status` are both refreshed every ~3h by
`updateNoteFeedback.ts` (verified fresh vs `public_data_snapshots`, ~1-day lag).

## Scope / filters

- Window: notes `submitted_at` in **2026-05-01 → now−2 days** (2-day tail dropped for the
  ~48h public-dump lag).
- **545 notes excluded** for unrecorded `feed_size` (≈all early May — feed tracking only
  became reliable in June); defaulting them to "small" would have polluted the Small bucket.
- Routine gaps span p5=27min … median=46min … p95=98min (max 727min), so x has real variance.
  (GitHub dropped ~⅔ of the */15 scheduled runs, which produces the gap spread.)

## Result — no relationship with the routine gap, for either metric or feed

Failure-type counts in scope (1,869 notes binned to a routine):

| Feed  | base notes | helpful | NMR | lost_to_competitor |
|-------|-----------:|--------:|----:|-------------------:|
| Small |        981 |     125 | 733 |                123 |
| Large |        826 |      84 | 686 |                 56 |

Correlation of per-routine rate vs. gap:

| Metric | Feed  | routines | rate | Pearson r | Spearman ρ | R²    |
|--------|-------|---------:|-----:|----------:|-----------:|------:|
| helpful| Small |      559 | 12.7% |   −0.064 |     −0.047 | 0.004 |
| helpful| Large |      423 | 10.2% |   +0.011 |     +0.025 | 0.000 |
| lost   | Small |      559 | 12.5% |   +0.015 |     +0.057 | 0.000 |
| lost   | Large |      423 |  6.8% |   −0.006 |     −0.025 | 0.000 |

Pooled-by-gap-bin views (`*_pooled_*.png`) wobble within overlapping 95% CIs with no trend.
**The routine gap does not predict either outcome, in either feed.**

Cross-feed observation (independent of the gap): the **Small feed is roughly twice as
competitive** — it both wins (12.7% vs 10.2% helpful) and loses to competitors (12.5% vs 6.8%)
more than the Large feed; Large-feed tweets sit in NMR more often (less competition / fewer
raters). 155 of our helpful notes also had a helpful competitor (both notes can show — these
correctly stay `rated_helpful`, not `lost`).

**Caveat:** outcomes are *current* status, so y partly reflects note age (older notes had more
time to resolve). Age is ~independent of the routine gap, so it adds noise, not x-bias.

## Files

- `fetch_runs.py` — cache routine starts from GitHub Actions → `routine_runs.json`
- `analyze.py` — classify, bin, split by feed, plot both metrics →
  `<metric>_scatter_<feed>.png`, `<metric>_pooled_<feed>.png`, `<metric>_per_routine_<feed>.csv`
  (`metric` ∈ {`helpful`, `lost`})
- `diagnostics.py` — gap distribution, binning spot-check, cn_status freshness
- `verify_lost.py` — spot-checks lost_to_competitor labeling vs the dashboard rule

Re-run: `uv run fetch_runs.py` then `uv run analyze.py`.
