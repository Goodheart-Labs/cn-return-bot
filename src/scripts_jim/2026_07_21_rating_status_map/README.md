# Rating counts → note outcome

Three steps: the raw map of the plane (`plot_map.py`), a two-input model for
P(helpful | not rated unhelpful) (`fit_helpful.py`), and the one-input version
that sees only the rating count (`fit_ratings_only.py`). Shared sample loading,
binning, cross-validation and chart styling live in `ratings_model.py`.

```bash
cd src/scripts_jim/2026_07_21_rating_status_map
uv run fetch.py            # → ratings_status.json  (the only step that hits Supabase)
uv run plot_map.py         # → rating_status_map.png
uv run fit_helpful.py      # → helpful_fit.png
uv run fit_ratings_only.py # → ratings_only_fit.png
uv run fit_overshoot.py    # → overshoot_fit.png
uv run fetch_views.py      # → views_sample.json  (tweet impressions + note views)
uv run fit_views.py        # → views_fit.png, views_functions.png, views_goodness.png
```

## Data

- `note_ratings_from_public_dump` — latest public dump (2026-07-21), one row per
  note, 5,400 rows. (`notes.helpful_count` is frozen at 2026-02-22 — unusable.)
- `notes.cn_status` — current X status.
- 5,391 notes after dropping ones with only somewhat-helpful ratings (helpful
  share undefined). 4,506 NEEDS_MORE_RATINGS / 689 helpful / 196 not helpful.

Axes: x = total ratings (helpful + somewhat + not helpful), log scale;
y = helpful share = helpful / (helpful + not helpful); colour = share of the
bin's notes that are no longer NEEDS_MORE_RATINGS.

## What the plane looks like

- **Under ~6 ratings nothing ever resolves** — P(decided) is 0 across the whole
  helpful-share range. There is a hard floor before X's scorer will call anything.
- **Between ~8 and ~100 ratings the plane is a U in helpful share**: consensus in
  either direction resolves, disagreement does not. At ~35 ratings: 52% decided at
  a 5% helpful share, ~3% decided in the 45–65% middle, 55% decided at a 95%
  helpful share.
- **The negative arm resolves earlier than the positive arm.** At ~8–17 ratings a
  low helpful share already hits 40–75% decided while a high helpful share is
  still ~0%. Not-helpful verdicts land on far less evidence than helpful ones.
- **It is not monotone in rating count.** Past ~140 ratings P(decided) *falls*
  (e.g. 5–25% decided through most of the 283-rating column). Notes that collect
  hundreds of ratings and still sit at NMR are contested — high volume is a signal
  of controversy, not of an imminent verdict.

## The fit — P(helpful | not rated unhelpful)

`fit_helpful.py`. The 196 CURRENTLY_RATED_NOT_HELPFUL notes are dropped, so the
sample is 5,195 notes (689 helpful, 13.3%) and the question is: among notes that
won't be judged unhelpful, which make it to helpful rather than sitting at
NEEDS_MORE_RATINGS forever?

Nested logistic models, scored by 5-fold cross-validated log loss:

| model | log loss | vs base | AUC | Brier |
|---|---|---|---|---|
| intercept only (13.3% base rate) | 0.3914 | — | — | 0.1150 |
| share | 0.3504 | 0.0409 | 0.682 | 0.1085 |
| share + log n | 0.2544 | 0.1370 | 0.913 | 0.0815 |
| share + log n + log n² | 0.2252 | 0.1661 | 0.929 | 0.0724 |
| share + log n + log n² + share×log n | **0.2213** | 0.1701 | 0.929 | 0.0714 |

`logit p = -12.628 + 0.775·share + 6.684·log₁₀n − 2.472·(log₁₀n)² + 4.961·share·log₁₀n`

**Take the three-term model unless you need the shape.** The interaction wins on
log loss by 0.004 and moves AUC not at all; its only real job is letting the
optimal rating count depend on share (peak at n ≈ 90 at a 60% share, n ≈ 227 at
100%). If you just want a number, `share + log n + log n²` is the honest "simple
model" — 98% of the achievable log-loss gain.

Fitted probabilities:

| | 60% | 75% | 90% | 95% | 100% helpful share |
|---|---|---|---|---|---|
| 10 ratings | 0.7% | 1.6% | 3.7% | 4.9% | 6.4% |
| 30 ratings | 3.6% | 11.2% | 29.8% | 38.9% | 48.9% |
| 100 ratings | 6.1% | 24.5% | 61.8% | 73.4% | 82.5% |
| 300 ratings | 3.2% | 19.2% | 62.7% | 76.4% | 86.1% |
| 1000 ratings | 0.4% | 4.4% | 32.5% | 51.3% | 69.8% |

- **Rating count carries far more than helpful share.** Share alone gets AUC 0.68;
  adding log n jumps to 0.91. Knowing a note is at 95% helpful tells you little —
  knowing it has 100 ratings tells you a lot.
- **The quadratic is doing real work** (0.029 log loss on its own, more than share
  contributes). Volume helps up to a point and then hurts: at a 95% share, 100–300
  ratings gives ~75%, but 1000 ratings drops to 51%.
- **Calibration is good** across the range; the mid deciles run slightly
  underconfident (predicted 35% → observed 46%).

## The one-input fit — rating count only

`fit_ratings_only.py`. Same sample and same target, helpful share withheld.

| model | log loss | vs base | AUC | Brier |
|---|---|---|---|---|
| intercept only | 0.3914 | — | — | 0.1150 |
| log n | 0.3462 | 0.0452 | 0.776 | 0.1088 |
| log n + log n² | **0.3175** | 0.0738 | 0.786 | 0.1013 |
| log n + log n² + log n³ | 0.3177 | 0.0737 | 0.789 | 0.1013 |

`logit p = -9.483 + 8.306·log₁₀n − 1.988·(log₁₀n)²` — a hump, not a ramp. The
cubic term buys nothing, so two terms is the whole model.

| ratings | 10 | 25 | 50 | 100 | 200 | 400 | 1000 | 2000 |
|---|---|---|---|---|---|---|---|---|
| P(helpful \| not unhelpful) | 4.0% | 14.7% | 24.8% | **30.5%** | 29.0% | 20.9% | 7.9% | 2.4% |

- **The count alone never gets you past ~31%.** Peak is at n ≈ 123; every other
  count is worse. So rating volume can tell you a note is *plausibly* going to
  land, never that it probably will — you need the share for that.
- **It captures 43% of the achievable log-loss gain** (0.074 of 0.170) and AUC
  0.786 vs 0.929. Useful as a cheap ranker, not as a probability you'd act on.
- **The downturn is real, not a fitting artifact.** Observed rates fall from 30.5%
  in the 50–100 bin to 16.5% in the 200–400 bin, and those two Wilson intervals
  are disjoint ([27.3, 34.0] vs [11.8, 22.6]). Past 400 ratings the bins are too
  small to separate (61 and 25 notes), so the far tail rests on the model, not the
  data. Reading: notes that keep collecting ratings without resolving are
  contested, and contested notes mostly stay at NMR.

## Overshoot-and-settle — the better one-input model

`fit_overshoot.py`. The quadratic above forces P → 0 as n → ∞, but the observed
tail bins hold at 16–20%. The headline family is a sigmoid rise to a plateau
with a transient Gaussian bump on top — the peak's location and width are their
own parameters:

`p(x) = L·σ(a(x−p)) + C·exp(−(x−m)²/2s²)`, x = log₁₀n. A difference of two
logistics (`A·σ(a(x−p)) − B·σ(b(x−q))`) is kept as a comparison. Both fitted by
maximum likelihood (L-BFGS-B, multi-start — the likelihoods are non-convex and
single starts occasionally land in bad optima), scored on identical CV folds:

| model | log loss | vs base | AUC | Brier |
|---|---|---|---|---|
| log n + log n² (logistic) | 0.3175 | 0.0738 | 0.786 | 0.1013 |
| sigmoid + bump | **0.3040** | 0.0873 | 0.800 | 0.0992 |
| two logistics | 0.3042 | 0.0871 | 0.799 | 0.0993 |

Fitted: `L = 0.184, a = 19.80, p = 1.284 (n≈19) · C = 0.131, m = 1.798 (n≈63),
s = 0.254` (the bump spans ≈1.8× in n either side) → peak 31.5% at n ≈ 63,
**plateau 18.4%**.

| ratings | 10 | 25 | 50 | 100 | 200 | 400 | 1000 | 2000 |
|---|---|---|---|---|---|---|---|---|
| quadratic | 4.0% | 14.7% | 24.8% | 30.5% | 29.0% | 20.9% | 7.9% | 2.4% |
| sigmoid + bump | 0.2% | 20.5% | 30.6% | 28.0% | 20.3% | 18.5% | 18.4% | 18.4% |

- **Beats the quadratic everywhere it matters** — 0.014 CV log loss, the largest
  single-model-family gain in the 1-D comparison, and the curve threads every
  bin's Wilson interval including the tail the quadratic misses.
- **The two overshoot families are statistically indistinguishable** (0.3040 vs
  0.3042, curves nearly on top of each other), so the data can't pick between
  "a bump on a plateau" and "a rise partially undone". Sigmoid + bump is the
  headline because its parameters answer the useful questions directly: where the
  peak is (m), how wide the window is (s), how high the floor is (L).
- **The story**: a sharp onset around n ≈ 19 (X's effective minimum evidence), a
  transient bump of +13 points centred at 63 ratings, and a floor of ~18% —
  high-volume notes are not doomed, they're a coin weighted toward NMR.

## Tweet-side model — (impressions, recency) → note outcome

`fetch_views.py` + `fit_views.py` → `views_fit.png`, `views_functions.png`,
`views_goodness.png`. Sample: 3,586 submitted notes with complete tweet data
(tweets before ~Mar 2026 lack impressions), NOT_HELPFUL excluded, 389 helpful
(10.8%). Everything runs through one intermediate feature — the tweet's
**predicted additional views over the next week** from the growth curve
V(t) ∝ ln(1 + t/τ), τ = 0.8 h:

`future_views = V1·(ln(1+(t1+168)/τ)/ln(1+t1/τ) − 1)`, `x = log₁₀(future_views+1)`

where V1 = impressions and t1 = tweet age in hours at first sight. The tweets
table is insert-only, so impressions are frozen at first sight and the (V1, t1)
pair is exact — not a proxy. (DATABASE.md's "latest values, refreshed every
run" line described feed_tweets, not tweets; fixed there.)

**The three functions** (all monotone in x):

1. `P(helpful | not unhelpful) = 0.173·σ(1.06·(x − 4.579))` — a saturating
   sigmoid (the two-logistics family with its drop term degenerate at zero);
   saturates at 17.3%, midpoint ≈38k future views
2. `E[views | helpful] = 2.700·10^(2.029 + 0.457·x) − 1` (log-linear + smearing;
   fit on 364 helpful notes with scraped views), and
   `E[views | not unhelpful] = P · E[views | helpful]` (NMR = 0 views)
3. `score = (P/0.171)^0.5 · (E[views]/495,984)^0.5` — weighted geometric mean,
   normalised over the plausible input span (10³–10⁸ impressions, ≥1 h)

| impressions, age | future views | P(helpful) | E[views] | score |
|---|---|---|---|---|
| 100k, 1h | 561k | 13.5% | 16,542 | 0.162 |
| 100k, 24h | 60k | 9.6% | 4,225 | 0.069 |
| 1M, 1h | 5.6M | 15.8% | 55,553 | 0.321 |
| 1M, 24h | 597k | 13.5% | 17,136 | 0.165 |
| 10M, 1h | 56M | 16.8% | 169,265 | 0.578 |

**Honest findings, the important ones first:**

- **The signal is weak.** CV: saturating sigmoid 0.3368 vs base 0.3433
  (AUC 0.592) — compare AUC 0.786 for ratings-based inputs. Reach barely
  separates helpful-vs-NMR; it mostly determines *how many views a helpful note
  gets* (the E[views | helpful] fit is strong and visibly linear in log-log).
- **The P-model is the two-logistics family with its drop term at zero** —
  A·σ(a(x−p)). The observed rate rises monotonically with reach (no overshoot:
  views don't accumulate on contested notes the way ratings do), so the full
  6-parameter two-logistics overfits (CV 0.3474, worse than base; its fitted dip
  at ~250 views is noise). The saturating form wins the CV comparison outright
  (0.3368 vs plain logistic 0.3372) and extrapolates sanely — capped at 17.3%
  instead of climbing forever.
- **All three functions are monotone in x, so they induce the same ranking.**
  The combined score only matters against a *different* signal. The capture plot
  therefore compares the shared ranking against **velocity** (current pipeline
  criterion): both capture ~73% of realized note views in the top 20% of notes,
  and the two curves are nearly identical. **Ranking by predicted future views
  is not measurably better than ranking by velocity on this sample** — the
  growth curve mostly preserves the velocity ordering.
- Calibration of P is good across its (narrow) 4–17% range. (An explicit floor
  term `c + A·σ(a(x−p))` was tested — ML sets c = 0 and CV is unchanged; the
  raw data below 1k future views is 1 helpful in 109 notes, so there is no
  evidence for a baseline probability at zero reach.)
- The functions extrapolate beyond the observed x range for the biggest inputs
  (observed p99 ≈ 5.5M future views); treat >10M as extrapolation.

## Conditioning on the feed (`fit_views_by_feed.py` → `views_by_feed.png`)

Each note bucketed by its submitting run's `ab_test_picks->>'feed_size'`
(small vs large|xl|xxl); 2,750 of the 3,586 notes carry a pick. The pooled
saturating-sigmoid is evaluated within each bucket:

| bucket | n | helpful | pred. mean | LL vs base | AUC |
|---|---|---|---|---|---|
| all (with pick) | 2,750 | 10.4% | 10.4% | +0.0077 | 0.602 |
| small | 1,248 | 11.9% | 11.4% | −0.0002 | 0.539 |
| large | 1,502 | 9.3% | 9.6% | +0.0127 | 0.651 |

- **Within the large feed the signal survives and strengthens** (AUC 0.651,
  better than pooled). The bins rise monotonically and the pooled curve tracks
  them; the per-feed refit shifts the midpoint right (≈132k views) but keeps
  the shape.
- **Within the small feed the signal dies** (AUC 0.539, log loss no better than
  the feed's own base rate). The bins are flat-to-noisy around 12% and the
  refit is nearly flat (slope 0.44). The small feed already selects
  high-velocity posts, so within it reach has little residual variation left to
  discriminate on.
- **Calibration survives in both buckets** (predicted means 11.4%/9.6% vs
  actual 11.9%/9.3%) — the pooled model doesn't systematically over- or
  under-predict either feed, it just can't rank within the small one.
- Practical reading: reach-based P is a *large-feed* instrument. That is also
  where selection actually operates (the large pool is what gets filtered);
  inside the small feed, notes are roughly equally likely (~12%) regardless of
  predicted reach.

## Filter face-off: velocity floor vs. our P(helpful) (`fit_filter_comparison.py`)

Two threshold filters on the pool of 3,711 submitted notes with complete tweet
data (390 helpful = 10.5%; 125 not-helpful, all counted as negatives — a
pre-pipeline filter faces them too). Positive = ended helpful. Each filter is a
monotone score swept over every threshold:

| filter | PR-AUC | ROC-AUC | max F1 | precision | recall | keep | operating point |
|---|---|---|---|---|---|---|---|
| velocity | 0.136 | 0.594 | **0.219** | 17.3% | 30.0% | 18.2% | ≥ 91,403 impressions/h |
| P(helpful) | 0.133 | 0.589 | **0.213** | 13.9% | 45.4% | 34.3% | P ≥ 12.8% (≈359k future views) |
| no filter (submit all) | — | — | 0.190 | 10.5% | 100% | 100% | — |

**They are operationally the same, with velocity a hair ahead.** The PR curves
lie on top of each other. A paired bootstrap of the PR-AUC gap: velocity − P =
+0.0028, 95% CI [+0.0001, +0.0055], velocity better in 98% of resamples — so the
edge is *statistically* real but *magnitudinally* trivial (both ≈0.135). Our
function does **not** beat the velocity floor here; if anything it is marginally
worse.

- **Both barely beat "submit everything."** Max F1 0.219 / 0.213 vs 0.190 — a
  small lift. Reach is a weak predictor of helpful *among already-submitted
  notes* (the strong signal lives in the ratings a note later collects: AUC 0.93
  with ratings inputs vs 0.59 with reach).
- **The two optima sit at different keep-fractions but similar F1**: velocity's
  peak keeps 18% at higher precision; P's peak keeps 34% at higher recall. On the
  F1-vs-keep curve everything from ~20% to ~85% kept is a plateau around
  F1 ≈ 0.21 — the choice of *where* to cut barely matters, and *which score* you
  cut on matters even less.
- **Reference:** the current 30k/h floor would keep 40.7% of these notes and 51%
  of the helpful ones — a higher-recall, lower-precision point than either F1
  optimum, consistent with a floor tuned to not lose winners rather than to
  maximize hit rate.

**Takeaway for the ranking question:** switching the pipeline filter from
velocity to our P(helpful) function would not improve which notes get through on
this evidence — pick the filter on other grounds (velocity is simpler and needs
no fitted model). The function's value over a velocity floor is not *ranking*
but the *calibrated numbers* it emits (P and E[views]), usable for
expected-value budgeting of the daily cap.

CAVEAT: within-submitted retrospective. We only have outcomes for notes we
actually submitted, many already chosen under a velocity floor, so the
low-velocity region is under-sampled and the real gain of either filter on the
full candidate pool is not observable here.

## Rob's velocity stats, head-to-head (`fit_velocity_stats.py`)

The velocity proposal's two framings, Helpful-only, computed for BOTH scores on
the 3,711 submitted notes with complete tweet data (10.5% reached Helpful).

**Helpful rate by score quintile** (fifth 1 = slowest / lowest P):

| fifth | velocity range | Helpful | P(helpful) range | Helpful |
|---|---|---|---|---|
| 1 | 0 – 3.5k/h | 5.4% | 0.1% – 8.4% | 5.2% |
| 2 | 3.5k – 11k/h | 9.8% | 8.4% – 10.6% | 10.9% |
| 3 | 11k – 31k/h | 11.3% | 10.6% – 12.4% | 10.2% |
| 4 | 31k – 82k/h | 9.7% | 12.4% – 13.9% | 10.5% |
| 5 | 82k/h+ | 16.3% | 13.9% – 16.9% | 15.6% |

**Floor replay** — Helpful notes retained above each percentile floor:

| floor | keep | velocity threshold | Helpful kept | P threshold | Helpful kept |
|---|---|---|---|---|---|
| p10 | 90% | 1,215/h | 96.4% | P ≥ 6.3% | 96.2% |
| p20 | 80% | 3,549/h | 89.7% | P ≥ 8.4% | 90.0% |
| p50 | 50% | 19,255/h | 59.5% | P ≥ 11.5% | 59.2% |

- **Rob's floor numbers reproduce on this pool** (p10 → 96%, p20 → 90%) and hold
  for our function verbatim — the two scores are near-identical rankings of the
  same (impressions, age) pair, so every stat matches within a point.
- The proposal's core claim stands for both scores: the slowest fifth converts
  at ~5% vs ~16% for the fastest, and a p10 floor reclaims 10% of cap for a
  ~3.7% Helpful loss.
- Verdict unchanged from rounds seven–eight: as a filter the two are
  interchangeable; velocity is simpler, the function's edge is its calibrated
  P / E[views] outputs, not better ranking.

## Caveats before fitting

- Counts are the *current* snapshot, not counts as of the decision, so this is a
  cross-section, not a hazard curve. Decided notes kept accruing ratings after
  their verdict. A predictive model wants the dump time series, but the table only
  keeps the newest dump per note (no history is retained).
- No censoring correction. NMR share is roughly flat by note age (86% at 1–2
  weeks, 82% past 8 weeks), so young notes aren't dominating the NMR mass, but
  some of today's NMR notes will still resolve.
- X's scorer is a bridging matrix factorization over *who* rated, not raw counts —
  the counts are a projection of the real decision variable. The U shape and the
  high-volume dip are exactly where that projection loses the most information.
- Bins shown have ≥8 notes; the sparse corners (low helpful share, >250 ratings)
  are single-digit-N and should not be read as a trend.
