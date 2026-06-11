# Large-feed helpful predictor (2026-06-11)

Can `tweets`-table metrics predict whether a note we submit gets rated
**CURRENTLY_RATED_HELPFUL** vs stays **NEEDS_MORE_RATINGS**? Restricted to the
**large feed** (`pipeline_runs.ab_test_picks->>'feed_size' = 'large'`),
**last 7 days, excluding the last 24h**.

## Scripts
- `00_size.py` — sizing probe for the window.
- `01_fetch.py` — builds `dataset.csv` (7-day window); `--all` → `dataset_all.csv` (all large-feed history).
- `02_train.py` — L2 logistic regression, repeated-CV AUC + permutation test + coefficients; `--all` for the history set.

Features: log(followers, author_tweet_count, impressions, likes, retweets,
replies, quotes, bookmarks, media_count), tweet_age_at_submission_h,
has_video, has_photo. Label: 1 = CRH, 0 = NMR (NH dropped).

## Headline result

**On the exact requested window, the metrics do NOT predict helpfulness.**

| dataset | n | CRH | repeated-CV AUC | permutation p |
|---|---|---|---|---|
| **large feed, last 7d excl. 24h** | 112 | 16 (14%) | **0.50 ± 0.16** | **0.38** (not significant) |
| all large-feed history (May+Jun) | 309 | 32 (10%) | 0.60 ± 0.10 | 0.066 (borderline) |

The 7-day window has only **16 positives** — far too few for a 12-feature
model (rule of thumb wants ~10 events/feature, i.e. ~120 positives). AUC 0.50
= chance; the permutation test can't distinguish the fit from shuffled labels.

With ~2× the positives (all large-feed history) a **weak** signal appears
(AUC ~0.60, p≈0.07), but it's still borderline and not deployable.

## What weak signal there is (consistent across both fits)
- **More retweets → less likely to be rated helpful** (strongest coefficient,
  same sign in both). Viral/contested posts are harder to land a helpful note on.
- **More bookmarks / replies → more likely helpful.**
- Author followers, impressions, media flags, tweet age: near-zero.

## Caveats
- `tweets` engagement columns are the **latest** refreshed values, not the
  values at submission time (DATABASE.md) — mild leakage/noise.
- The 7-day window is the binding constraint, not data availability: large-feed
  runs exist for May 16–21 and Jun 6–11, but the window only sees the June slice.
- To get a usable predictor, either widen the window (use `--all`) or wait for
  more large-feed volume to accumulate.
