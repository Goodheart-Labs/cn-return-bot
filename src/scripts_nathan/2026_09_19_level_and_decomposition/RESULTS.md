# Level and decomposition: forecasting the base rate, and P(H) = P(rated) x P(H | rated) (2026-09-19)

1. **Scored set.** The identical 977 matured notes as the prior backtest, submitted 2026-08-23 07:00 to 2026-09-11 18:39 UTC: H 90 (9.2%), NH 27 (2.8%), rated at all 117 (12.0%). `prior_all`, `prior_30d` and `stable4` were recomputed from scratch here and reproduce the prior run's predictions to the last digit; `prior_30d` H Brier = 0.08450, the number to beat. Daily refit, a fit on day D sees only labels of notes submitted before D - 7d, all 20 forecasters scored on the identical notes.
2. **Pre-registration.** Half-life grid {7, 14, 30, 60} days, fixed before running; rule = lowest Brier for H over every note submitted 2026-07-01 to 2026-08-15 (2,473 notes, 259 H, labels all resolved by the first scored day). It chose **60 days**, the longest — the training period asked for a *slower* forecaster. The grid's training Brier spread is 0.00009, so the rule was close to a coin flip; a narrower selection set (602 window notes from 2026-08-07) would have chosen 7 days. Both reported, 60 is the headline.
<!-- LEVEL-TABLE-START -->
| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? | mean pred / observed | cal-in-large | log loss |
|---|---|---|---|---|---|---|
| `prior_all` | 0.08450 | -0.00000 [-0.00010, +0.00010] | no | 12.18% / 9.21% | +2.97pp | 0.3118 |
| `prior_30d` | 0.08450 | ref | - | 12.30% / 9.21% | +3.08pp | 0.3118 |
| `ewma_hl7` | 0.08441 | -0.00009 [-0.00023, +0.00005] | no | 12.16% / 9.21% | +2.95pp | 0.3113 |
| `ewma_hl14` | 0.08432 | -0.00019 [-0.00033, -0.00004] | yes, better | 11.93% / 9.21% | +2.72pp | 0.3109 |
| `ewma_hl30` | 0.08416 | -0.00034 [-0.00062, -0.00005] | yes, better | 11.56% / 9.21% | +2.35pp | 0.3102 |
| `ewma_hl60` | 0.08413 | -0.00037 [-0.00068, -0.00006] | yes, better | 11.48% / 9.21% | +2.27pp | 0.3100 |
| `ewma_sel`  **(headline)** | 0.08413 | -0.00037 [-0.00068, -0.00006] | yes, better | 11.48% / 9.21% | +2.27pp | 0.3100 |
| `ewma_auto` | 0.08413 | -0.00037 [-0.00068, -0.00006] | yes, better | 11.48% / 9.21% | +2.27pp | 0.3100 |
| `local_linear_trend` | 0.08472 | +0.00021 [-0.00000, +0.00042] | no | 12.62% / 9.21% | +3.41pp | 0.3127 |
| `smooth_trend` | 0.08573 | +0.00123 [+0.00056, +0.00188] | yes, worse | 13.90% / 9.21% | +4.68pp | 0.3170 |
| `stable4` | 0.08492 | +0.00041 [-0.00119, +0.00196] | no | 13.40% / 9.21% | +4.19pp | 0.3119 |
| `stable4_lvl_ewma_sel` | 0.08389 | -0.00061 [-0.00193, +0.00062] | no | 11.99% / 9.21% | +2.78pp | 0.3077 |
| `stable4_lvl_local_linear_trend` | 0.08468 | +0.00017 [-0.00140, +0.00168] | no | 13.17% / 9.21% | +3.95pp | 0.3110 |
| `stable4_lvl_smooth_trend` | 0.08598 | +0.00147 [-0.00050, +0.00336] | no | 14.49% / 9.21% | +5.28pp | 0.3160 |
| *constant at observed rate (HINDSIGHT, not a forecast)* | 0.08363 | -0.00087 | - | 9.21% / 9.21% | +0.00pp | 0.3074 |
<!-- LEVEL-TABLE-END -->
3. **Something beats `prior_30d`, and it is the pre-registered one.** `ewma_sel` (half-life 60d) cuts H Brier to 0.08413, -0.00037 [-0.00068, -0.00006] note bootstrap and [-0.00064, -0.00011] day-block — both exclude zero on the better side. On rated-at-all it is -0.00051 [-0.00088, -0.00012]. On NH nothing moves (-0.00001). Every EWMA at 14 days or longer clears zero; 7 days does not.
4. **But the mechanism is the opposite of the hypothesis.** The winner is not more responsive, it is *less*: across the three scored weeks it moves 11.5 → 11.5 → 11.4% while `prior_30d` moves 12.6 → 12.3 → 12.0% and observed falls 10.0 → 9.2 → 8.4%. It wins by averaging over a mean label age of 52 days instead of 15, reaching back into July (9.1% H) and April (8.1%). Extrapolation actively hurt: the local-linear-trend MLE put the slope variance on the zero boundary in training, and `smooth_trend`, which forces a moving trend, overshot *upward* to 13.9% and was significantly worse (+0.00123). The level error is reduced, not fixed — still +2.27pp against +3.08pp, capturing 43% of the 0.00087 that a hindsight-perfect constant would buy.
5. **Ranking plus level is the best legal point estimate but is not significant.** `stable4_lvl_ewma_sel` (stable4 slopes, intercept swapped) gets H Brier 0.08389 and log loss 0.3077, closer to the hindsight constant's 0.3074 than anything else. It beats `stable4` by -0.00102 [-0.00160, -0.00043] (fixing the level is a real gain for the feature model) but beats `ewma_sel` by only -0.00024 [-0.00161, +0.00107]: the ranking adds nothing detectable once the level is right.
<!-- DECOMP-TABLE-START -->
**Target H** (positives 90 of 977)

| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? | mean pred / observed | cal-in-large | log loss |
|---|---|---|---|---|---|---|
| `prior_30d` | 0.08450 | ref | - | 12.30% / 9.21% | +3.08pp | 0.3118 |
| `stable4` | 0.08492 | +0.00041 [-0.00119, +0.00196] | no | 13.40% / 9.21% | +4.19pp | 0.3119 |
| `ewma_sel` | 0.08413 | -0.00037 [-0.00068, -0.00006] | yes, better | 11.48% / 9.21% | +2.27pp | 0.3100 |
| `two_prior` | 0.08449 | -0.00001 [-0.00003, +0.00000] | no | 12.29% / 9.21% | +3.07pp | 0.3117 |
| `two_prior_m50` | 0.08450 | -0.00001 [-0.00001, +0.00000] | no | 12.29% / 9.21% | +3.08pp | 0.3118 |
| `two_prior_m200` | 0.08449 | -0.00002 [-0.00004, +0.00001] | no | 12.28% / 9.21% | +3.07pp | 0.3117 |
| `two_ewma` | 0.08414 | -0.00036 [-0.00066, -0.00006] | yes, better | 11.50% / 9.21% | +2.29pp | 0.3101 |
| `two_stable4` | 0.08456 | +0.00005 [-0.00101, +0.00097] | no | 12.79% / 9.21% | +3.58pp | 0.3110 |
| `two_stable4_lvl` | 0.08395 | -0.00055 [-0.00148, +0.00028] | no | 11.75% / 9.21% | +2.54pp | 0.3083 |

**Target NH** (positives 27 of 977)

| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? | mean pred / observed | cal-in-large | log loss |
|---|---|---|---|---|---|---|
| `prior_30d` | 0.02693 | ref | - | 3.39% / 2.76% | +0.62pp | 0.1273 |
| `stable4` | 0.02677 | -0.00016 [-0.00062, +0.00026] | no | 2.87% / 2.76% | +0.10pp | 0.1208 |
| `ewma_sel` | 0.02691 | -0.00001 [-0.00006, +0.00003] | no | 3.37% / 2.76% | +0.61pp | 0.1271 |
| `two_prior` | 0.02693 | +0.00000 [-0.00001, +0.00001] | no | 3.40% / 2.76% | +0.63pp | 0.1273 |
| `two_prior_m50` | 0.02693 | +0.00000 [-0.00000, +0.00000] | no | 3.39% / 2.76% | +0.63pp | 0.1273 |
| `two_prior_m200` | 0.02693 | +0.00000 [-0.00001, +0.00002] | no | 3.40% / 2.76% | +0.64pp | 0.1273 |
| `two_ewma` | 0.02691 | -0.00002 [-0.00006, +0.00003] | no | 3.35% / 2.76% | +0.59pp | 0.1271 |
| `two_stable4` | 0.02668 | -0.00025 [-0.00048, -0.00004] | yes, better | 3.47% / 2.76% | +0.71pp | 0.1233 |
| `two_stable4_lvl` | 0.02665 | -0.00028 [-0.00051, -0.00008] | yes, better | 3.36% / 2.76% | +0.60pp | 0.1228 |
<!-- DECOMP-TABLE-END -->
6. **The decomposition does not beat the direct model on any target.** Level-only two-stage is arithmetically the same forecast as one-stage (H diff -0.00001). With features, `two_stable4_lvl` is the only row that clears zero against `prior_30d` on NH (-0.00028 [-0.00051, -0.00008], day-block too); on H it does not (-0.00055 [-0.00148, +0.00028]). And against the one-stage `stable4` it is only -0.00012 [-0.00040, +0.00016] on NH, with a worse log loss (0.1228 vs 0.1208) and a much narrower spread (p10-p90 2.4-4.7% vs 1.1-6.4%). That is shrinkage buying Brier, not new signal.
7. **Feature split (the main qualitative result).** Getting rated at all is weakly predicted by tweet age at first sight (z -2.5), an author we have noted before without ever getting an H (z -2.2) and the evaluation score (z +1.8) — nothing is strong. Quality given rated is predicted by one thing only: an earlier note on the tweet, which barely moves P(rated) (coef -0.24, z -1.7) but takes P(H | rated) from 57% to 90% (coef +1.95, z +5.9). The attention factor holds most of the variance and almost none of the signal; the quality factor holds one large, real effect.
8. **Bottom line.** Yes, something now beats `prior_30d`: an EWMA level at a 60-day half-life, pre-registered, significant on H and on rated-at-all under both the note and day-block bootstraps. It is worth +0.4% Brier skill, closing 43% of the 0.00087 Brier gap to a hindsight-perfect constant and 26% of the +3.08pp level error. Small, real, and a win for a *longer* memory rather than for extrapolation — so "trailing windows are structurally late" is not what this data support. The decomposition is a clean explanatory result and a null forecasting result. Caveat: 20 forecasters x 3 targets x 2 intervals = 120 intervals, uncorrected; naming the headline in advance is what keeps that honest.
9. **What failed.** `materiality_engages` could not be tested: the offline pull selected `pipeline_scores` with `score_type = 'evaluation'` only, so no row of it exists on disk, and connecting to the database was out of scope. `pipeline_runs.ab_test_picks` has a `materiality_treatment` arm on 282 of 2,167 runs, but that is the A/B assignment, not the per-note judge verdict. Re-pulling is a one-line change to the sibling pull script.

<!-- AUTO-GENERATED BELOW THIS LINE BY report.py; edits below are overwritten -->

## Scored set and reproduction check

- Identical to the prior backtest: **977** matured notes submitted 2026-08-23 07:00 to 2026-09-11 18:39 UTC. H 90 (9.2%), NH 27 (2.8%), rated at all 117 (12.0%).
- `prior_30d`, `prior_all` and `stable4` were recomputed here from scratch and reproduce the prior run's predictions to the last digit (max absolute difference 0.0 over all three targets); `prior_30d` H Brier = 0.08450, the number to beat.
- All 20 forecasters cover the identical 977 notes for all three targets (asserted in code).

## Pre-registration and what the selection rule chose

- Half-life grid, fixed before running: **[7, 14, 30, 60]** days. Every one is reported below.
- Rule: lowest Brier for H on the selection set = every note submitted 2026-07-01 to 2026-08-15 UTC (2473 notes, 259 H, 10.5%), whose labels had all resolved by the first scored refit day. Ties -> longer half-life.
- **It chose `ewma_hl60`** (half-life 60 days) - the longest, i.e. the training period asked for a *slower* forecaster, not a faster one.
- The narrower robustness set (602 window notes submitted 2026-08-07 to 2026-08-15) would have chosen `ewma_hl7`. Reported for honesty; it is not the headline.

Selection-set Brier (training period, H). The spread across the grid is 0.00009, i.e. the training period contains essentially no information about the right half-life:

| forecaster | n | Brier | mean predicted | observed |
|---|---|---|---|---|
| `ewma_hl60` | 2473 | 0.09413 | 11.21% | 10.47% |
| `ewma_hl30` | 2473 | 0.09415 | 10.87% | 10.47% |
| `ewma_hl14` | 2473 | 0.09420 | 10.64% | 10.47% |
| `ewma_hl7` | 2473 | 0.09422 | 10.67% | 10.47% |
| `prior_all` | 2473 | 0.09439 | 12.44% | 10.47% |
| `prior_30d` | 2473 | 0.09447 | 10.16% | 10.47% |

Same on the narrow robustness set:

| forecaster | n | Brier | mean predicted | observed |
|---|---|---|---|---|
| `prior_all` | 602 | 0.11537 | 12.11% | 13.29% |
| `ewma_hl7` | 602 | 0.11558 | 11.26% | 13.29% |
| `ewma_hl60` | 602 | 0.11576 | 10.96% | 13.29% |
| `ewma_hl14` | 602 | 0.11581 | 10.81% | 13.29% |
| `ewma_hl30` | 602 | 0.11587 | 10.72% | 13.29% |
| `prior_30d` | 602 | 0.11637 | 9.93% | 13.29% |

## State-space fits (training period only)

Both filters run on the daily logit of the outcome rate over the whole note history (2025-10-10 to 2026-08-15, 304 days with notes), diffuse prior (P0 = 1e6 I, first two observations left out of the likelihood), Haldane-corrected daily logits with binomial observation variances. Variances estimated by maximum likelihood on days strictly before 2026-08-16 and then held fixed.

| target | model | q_level | q_slope | training log-likelihood |
|---|---|---|---|---|
| H | `local_linear_trend` | 2.337e-03 | 1.000e-10 | -307.74 |
| H | `smooth_trend` | 0.000e+00 | 4.652e-06 | -310.60 |
| NH | `local_linear_trend` | 1.589e-03 | 1.000e-10 | -392.98 |
| NH | `smooth_trend` | 0.000e+00 | 6.945e-07 | -393.48 |
| rated | `local_linear_trend` | 1.028e-03 | 1.000e-10 | -275.82 |
| rated | `smooth_trend` | 0.000e+00 | 4.110e-07 | -277.29 |

**The unrestricted local-linear-trend MLE puts the slope variance on the zero boundary for all three targets.** The training data prefer a local *level* (random walk) with one constant global drift; there is no time-varying trend to extrapolate. `smooth_trend` (level noise switched off, only the slope innovates) was added *after seeing that training-period diagnostic and before any test metric was computed*, to give a genuinely extrapolating model a fair run. Its training log-likelihood is worse than the local level's for every target, so the data did not want it either.

## Job 1: level forecasters, all three targets

Identical 977 notes in every row, probabilities clipped to [0.001, 0.999] before every metric. Differences are forecaster minus `prior_30d`, negative is better. Note bootstrap: 2000 resamples of notes, percentile interval, the same resamples in every row. The day-block bootstrap resamples whole submit days (20 of them) and is the more cautious interval.

### Target H (positives 90 of 977, 9.2%)

| forecaster | Brier | skill | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | mean pred | observed | cal-in-large | log loss | AUC | p10-p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.08450 | +0.0% | -0.00000 [-0.00010, +0.00010] | no | [-0.00012, +0.00011] | no | 12.18% | 9.21% | +2.97pp | 0.3118 | 0.512 | 12.1%-12.2% |
| `prior_30d` | 0.08450 | ref | ref | - | ref | - | 12.30% | 9.21% | +3.08pp | 0.3118 | 0.534 | 11.8%-12.6% |
| `ewma_hl7` | 0.08441 | +0.1% | -0.00009 [-0.00023, +0.00005] | no | [-0.00034, +0.00010] | no | 12.16% | 9.21% | +2.95pp | 0.3113 | 0.517 | 11.1%-12.9% |
| `ewma_hl14` | 0.08432 | +0.2% | -0.00019 [-0.00033, -0.00004] | yes, better | [-0.00034, -0.00005] | yes, better | 11.93% | 9.21% | +2.72pp | 0.3109 | 0.515 | 11.4%-12.3% |
| `ewma_hl30` | 0.08416 | +0.4% | -0.00034 [-0.00062, -0.00005] | yes, better | [-0.00059, -0.00011] | yes, better | 11.56% | 9.21% | +2.35pp | 0.3102 | 0.511 | 11.3%-11.7% |
| `ewma_hl60` | 0.08413 | +0.4% | -0.00037 [-0.00068, -0.00006] | yes, better | [-0.00064, -0.00011] | yes, better | 11.48% | 9.21% | +2.27pp | 0.3100 | 0.511 | 11.3%-11.6% |
| `ewma_sel` | 0.08413 | +0.4% | -0.00037 [-0.00068, -0.00006] | yes, better | [-0.00064, -0.00011] | yes, better | 11.48% | 9.21% | +2.27pp | 0.3100 | 0.511 | 11.3%-11.6% |
| `ewma_auto` | 0.08413 | +0.4% | -0.00037 [-0.00068, -0.00006] | yes, better | [-0.00064, -0.00011] | yes, better | 11.48% | 9.21% | +2.27pp | 0.3100 | 0.511 | 11.3%-11.6% |
| `local_linear_trend` | 0.08472 | -0.3% | +0.00021 [-0.00000, +0.00042] | no | [-0.00006, +0.00050] | no | 12.62% | 9.21% | +3.41pp | 0.3127 | 0.520 | 11.5%-13.4% |
| `smooth_trend` | 0.08573 | -1.5% | +0.00123 [+0.00056, +0.00188] | yes, worse | [+0.00055, +0.00198] | yes, worse | 13.90% | 9.21% | +4.68pp | 0.3170 | 0.511 | 11.8%-15.0% |
| `stable4` | 0.08492 | -0.5% | +0.00041 [-0.00119, +0.00196] | no | [-0.00147, +0.00238] | no | 13.40% | 9.21% | +4.19pp | 0.3119 | 0.592 | 8.2%-18.9% |
| `stable4_lvl_ewma_sel` | 0.08389 | +0.7% | -0.00061 [-0.00193, +0.00062] | no | [-0.00213, +0.00109] | no | 11.99% | 9.21% | +2.78pp | 0.3077 | 0.590 | 7.2%-16.8% |
| `stable4_lvl_local_linear_trend` | 0.08468 | -0.2% | +0.00017 [-0.00140, +0.00168] | no | [-0.00163, +0.00208] | no | 13.17% | 9.21% | +3.95pp | 0.3110 | 0.593 | 8.0%-18.7% |
| `stable4_lvl_smooth_trend` | 0.08598 | -1.7% | +0.00147 [-0.00050, +0.00336] | no | [-0.00077, +0.00380] | no | 14.49% | 9.21% | +5.28pp | 0.3160 | 0.594 | 8.8%-20.7% |
| `two_prior` | 0.08449 | +0.0% | -0.00001 [-0.00003, +0.00000] | no | [-0.00004, +0.00001] | no | 12.29% | 9.21% | +3.07pp | 0.3117 | 0.531 | 11.7%-12.6% |
| `two_prior_m50` | 0.08450 | +0.0% | -0.00001 [-0.00001, +0.00000] | no | [-0.00002, +0.00000] | no | 12.29% | 9.21% | +3.08pp | 0.3118 | 0.533 | 11.8%-12.6% |
| `two_prior_m200` | 0.08449 | +0.0% | -0.00002 [-0.00004, +0.00001] | no | [-0.00006, +0.00001] | no | 12.28% | 9.21% | +3.07pp | 0.3117 | 0.533 | 11.7%-12.6% |
| `two_ewma` | 0.08414 | +0.4% | -0.00036 [-0.00066, -0.00006] | yes, better | [-0.00063, -0.00011] | yes, better | 11.50% | 9.21% | +2.29pp | 0.3101 | 0.512 | 11.3%-11.6% |
| `two_stable4` | 0.08456 | -0.1% | +0.00005 [-0.00101, +0.00097] | no | [-0.00126, +0.00140] | no | 12.79% | 9.21% | +3.58pp | 0.3110 | 0.569 | 9.0%-16.6% |
| `two_stable4_lvl` | 0.08395 | +0.7% | -0.00055 [-0.00148, +0.00028] | no | [-0.00168, +0.00067] | no | 11.75% | 9.21% | +2.54pp | 0.3083 | 0.567 | 8.2%-15.2% |
| *constant at observed rate (HINDSIGHT)* | 0.08363 | +1.0% | -0.00087 | - | - | - | 9.21% | 9.21% | +0.00pp | 0.3074 | n/a | - |

### Target NH (positives 27 of 977, 2.8%)

| forecaster | Brier | skill | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | mean pred | observed | cal-in-large | log loss | AUC | p10-p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.02691 | +0.1% | -0.00001 [-0.00007, +0.00004] | no | [-0.00006, +0.00004] | no | 3.40% | 2.76% | +0.64pp | 0.1271 | 0.456 | 3.3%-3.4% |
| `prior_30d` | 0.02693 | ref | ref | - | ref | - | 3.39% | 2.76% | +0.62pp | 0.1273 | 0.468 | 2.9%-3.7% |
| `ewma_hl7` | 0.02692 | +0.0% | -0.00001 [-0.00006, +0.00006] | no | [-0.00007, +0.00008] | no | 3.14% | 2.76% | +0.38pp | 0.1272 | 0.453 | 2.5%-3.5% |
| `ewma_hl14` | 0.02692 | +0.0% | -0.00001 [-0.00003, +0.00002] | no | [-0.00003, +0.00003] | no | 3.32% | 2.76% | +0.55pp | 0.1272 | 0.463 | 2.9%-3.5% |
| `ewma_hl30` | 0.02692 | +0.0% | -0.00001 [-0.00004, +0.00002] | no | [-0.00004, +0.00002] | no | 3.38% | 2.76% | +0.61pp | 0.1272 | 0.462 | 3.1%-3.5% |
| `ewma_hl60` | 0.02691 | +0.1% | -0.00001 [-0.00006, +0.00003] | no | [-0.00005, +0.00003] | no | 3.37% | 2.76% | +0.61pp | 0.1271 | 0.449 | 3.2%-3.5% |
| `ewma_sel` | 0.02691 | +0.1% | -0.00001 [-0.00006, +0.00003] | no | [-0.00005, +0.00003] | no | 3.37% | 2.76% | +0.61pp | 0.1271 | 0.449 | 3.2%-3.5% |
| `ewma_auto` | 0.02691 | +0.1% | -0.00001 [-0.00006, +0.00003] | no | [-0.00005, +0.00003] | no | 3.37% | 2.76% | +0.61pp | 0.1271 | 0.449 | 3.2%-3.5% |
| `local_linear_trend` | 0.02713 | -0.8% | +0.00021 [+0.00000, +0.00039] | yes, worse | [-0.00003, +0.00041] | no | 4.34% | 2.76% | +1.58pp | 0.1300 | 0.477 | 3.9%-4.6% |
| `smooth_trend` | 0.02716 | -0.9% | +0.00024 [+0.00002, +0.00044] | yes, worse | [-0.00002, +0.00046] | no | 4.42% | 2.76% | +1.66pp | 0.1303 | 0.470 | 3.9%-4.7% |
| `stable4` | 0.02677 | +0.6% | -0.00016 [-0.00062, +0.00026] | no | [-0.00050, +0.00013] | no | 2.87% | 2.76% | +0.10pp | 0.1208 | 0.699 | 1.1%-6.4% |
| `stable4_lvl_ewma_sel` | 0.02678 | +0.5% | -0.00015 [-0.00066, +0.00030] | no | [-0.00052, +0.00018] | no | 3.07% | 2.76% | +0.30pp | 0.1208 | 0.697 | 1.2%-6.9% |
| `stable4_lvl_local_linear_trend` | 0.02712 | -0.7% | +0.00019 [-0.00056, +0.00089] | no | [-0.00038, +0.00070] | no | 3.96% | 2.76% | +1.20pp | 0.1229 | 0.699 | 1.6%-8.8% |
| `stable4_lvl_smooth_trend` | 0.02715 | -0.8% | +0.00023 [-0.00054, +0.00095] | no | [-0.00036, +0.00075] | no | 4.03% | 2.76% | +1.27pp | 0.1231 | 0.698 | 1.6%-9.0% |
| `two_prior` | 0.02693 | -0.0% | +0.00000 [-0.00001, +0.00001] | no | [-0.00001, +0.00001] | no | 3.40% | 2.76% | +0.63pp | 0.1273 | 0.461 | 3.0%-3.6% |
| `two_prior_m50` | 0.02693 | -0.0% | +0.00000 [-0.00000, +0.00000] | no | [-0.00000, +0.00001] | no | 3.39% | 2.76% | +0.63pp | 0.1273 | 0.465 | 2.9%-3.7% |
| `two_prior_m200` | 0.02693 | -0.0% | +0.00000 [-0.00001, +0.00002] | no | [-0.00001, +0.00002] | no | 3.40% | 2.76% | +0.64pp | 0.1273 | 0.455 | 3.0%-3.6% |
| `two_ewma` | 0.02691 | +0.1% | -0.00002 [-0.00006, +0.00003] | no | [-0.00006, +0.00003] | no | 3.35% | 2.76% | +0.59pp | 0.1271 | 0.462 | 3.2%-3.4% |
| `two_stable4` | 0.02668 | +0.9% | -0.00025 [-0.00048, -0.00004] | yes, better | [-0.00044, -0.00010] | yes, better | 3.47% | 2.76% | +0.71pp | 0.1233 | 0.705 | 2.4%-4.9% |
| `two_stable4_lvl` | 0.02665 | +1.1% | -0.00028 [-0.00051, -0.00008] | yes, better | [-0.00045, -0.00014] | yes, better | 3.36% | 2.76% | +0.60pp | 0.1228 | 0.711 | 2.4%-4.7% |
| *constant at observed rate (HINDSIGHT)* | 0.02687 | +0.2% | -0.00006 | - | - | - | 2.76% | 2.76% | +0.00pp | 0.1264 | n/a | - |

### Target rated (positives 117 of 977, 12.0%)

| forecaster | Brier | skill | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | mean pred | observed | cal-in-large | log loss | AUC | p10-p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.10670 | +0.0% | -0.00004 [-0.00022, +0.00014] | no | [-0.00030, +0.00028] | no | 15.58% | 11.98% | +3.60pp | 0.3717 | 0.486 | 15.4%-15.7% |
| `prior_30d` | 0.10674 | ref | ref | - | ref | - | 15.68% | 11.98% | +3.71pp | 0.3718 | 0.512 | 14.7%-16.1% |
| `ewma_hl7` | 0.10654 | +0.2% | -0.00020 [-0.00043, +0.00005] | no | [-0.00058, +0.00009] | no | 15.30% | 11.98% | +3.33pp | 0.3710 | 0.495 | 13.6%-16.3% |
| `ewma_hl14` | 0.10646 | +0.3% | -0.00028 [-0.00046, -0.00008] | yes, better | [-0.00047, -0.00009] | yes, better | 15.25% | 11.98% | +3.27pp | 0.3707 | 0.486 | 14.2%-15.8% |
| `ewma_hl30` | 0.10627 | +0.4% | -0.00046 [-0.00079, -0.00013] | yes, better | [-0.00082, -0.00011] | yes, better | 14.94% | 11.98% | +2.96pp | 0.3700 | 0.487 | 14.4%-15.2% |
| `ewma_hl60` | 0.10623 | +0.5% | -0.00051 [-0.00088, -0.00012] | yes, better | [-0.00092, -0.00010] | yes, better | 14.85% | 11.98% | +2.88pp | 0.3699 | 0.489 | 14.5%-15.0% |
| `ewma_sel` | 0.10623 | +0.5% | -0.00051 [-0.00088, -0.00012] | yes, better | [-0.00092, -0.00010] | yes, better | 14.85% | 11.98% | +2.88pp | 0.3699 | 0.489 | 14.5%-15.0% |
| `ewma_auto` | 0.10623 | +0.5% | -0.00051 [-0.00088, -0.00012] | yes, better | [-0.00092, -0.00010] | yes, better | 14.85% | 11.98% | +2.88pp | 0.3699 | 0.489 | 14.5%-15.0% |
| `local_linear_trend` | 0.10681 | -0.1% | +0.00007 [-0.00006, +0.00020] | no | [-0.00018, +0.00031] | no | 15.71% | 11.98% | +3.74pp | 0.3720 | 0.499 | 14.2%-16.6% |
| `smooth_trend` | 0.10748 | -0.7% | +0.00075 [+0.00037, +0.00110] | yes, worse | [+0.00030, +0.00119] | yes, worse | 16.55% | 11.98% | +4.58pp | 0.3745 | 0.498 | 15.2%-17.2% |
| `stable4` | 0.10639 | +0.3% | -0.00034 [-0.00165, +0.00089] | no | [-0.00169, +0.00101] | no | 16.27% | 11.98% | +4.29pp | 0.3694 | 0.579 | 12.1%-20.4% |
| `stable4_lvl_ewma_sel` | 0.10555 | +1.1% | -0.00119 [-0.00235, -0.00008] | yes, better | [-0.00237, +0.00012] | no | 15.11% | 11.98% | +3.14pp | 0.3662 | 0.577 | 11.2%-18.8% |
| `stable4_lvl_local_linear_trend` | 0.10617 | +0.5% | -0.00057 [-0.00183, +0.00063] | no | [-0.00185, +0.00074] | no | 15.98% | 11.98% | +4.01pp | 0.3686 | 0.580 | 11.8%-20.2% |
| `stable4_lvl_smooth_trend` | 0.10692 | -0.2% | +0.00018 [-0.00132, +0.00160] | no | [-0.00137, +0.00170] | no | 16.84% | 11.98% | +4.87pp | 0.3713 | 0.579 | 12.6%-21.1% |
| `two_prior` | 0.10674 | +0.0% | +0.00000 [+0.00000, +0.00000] | no | [+0.00000, +0.00000] | no | 15.68% | 11.98% | +3.71pp | 0.3718 | 0.512 | 14.7%-16.1% |
| `two_prior_m50` | 0.10674 | +0.0% | +0.00000 [+0.00000, +0.00000] | no | [+0.00000, +0.00000] | no | 15.68% | 11.98% | +3.71pp | 0.3718 | 0.512 | 14.7%-16.1% |
| `two_prior_m200` | 0.10674 | +0.0% | +0.00000 [+0.00000, +0.00000] | no | [+0.00000, +0.00000] | no | 15.68% | 11.98% | +3.71pp | 0.3718 | 0.512 | 14.7%-16.1% |
| `two_ewma` | 0.10623 | +0.5% | -0.00051 [-0.00088, -0.00012] | yes, better | [-0.00092, -0.00010] | yes, better | 14.85% | 11.98% | +2.88pp | 0.3699 | 0.489 | 14.5%-15.0% |
| `two_stable4` | 0.10639 | +0.3% | -0.00034 [-0.00165, +0.00089] | no | [-0.00169, +0.00101] | no | 16.27% | 11.98% | +4.29pp | 0.3694 | 0.579 | 12.1%-20.4% |
| `two_stable4_lvl` | 0.10555 | +1.1% | -0.00119 [-0.00235, -0.00008] | yes, better | [-0.00237, +0.00012] | no | 15.11% | 11.98% | +3.14pp | 0.3662 | 0.577 | 11.2%-18.8% |
| *constant at observed rate (HINDSIGHT)* | 0.10541 | +1.2% | -0.00132 | - | - | - | 11.98% | 11.98% | +0.00pp | 0.3664 | n/a | - |

## Daily level forecasts inside the scored period (target H)

`steps` is how many days the state-space forecast is projected past its last observed day. `slope` is the filtered slope in logits per day.

| day | notes | `prior_30d` | `ewma_hl7` | `ewma_hl14` | `ewma_hl30` | `ewma_hl60` = `ewma_sel` | `ewma_auto` pick | `local_linear_trend` | slope | `smooth_trend` | slope | steps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-23 | 20 | 12.5% | 12.5% | 11.9% | 11.4% | 11.4% | ewma_hl60 | 13.2% | -0.0022 | 14.6% | +0.0069 | 8 |
| 2026-08-24 | 16 | 12.5% | 12.5% | 11.9% | 11.5% | 11.4% | ewma_hl60 | 13.1% | -0.0022 | 14.5% | +0.0065 | 8 |
| 2026-08-25 | 19 | 12.7% | 13.2% | 12.4% | 11.7% | 11.6% | ewma_hl60 | 14.1% | -0.0019 | 15.7% | +0.0098 | 8 |
| 2026-08-26 | 62 | 12.6% | 12.9% | 12.3% | 11.7% | 11.6% | ewma_hl60 | 13.5% | -0.0021 | 15.1% | +0.0074 | 8 |
| 2026-08-27 | 59 | 12.6% | 12.9% | 12.3% | 11.7% | 11.6% | ewma_hl60 | 13.4% | -0.0021 | 14.9% | +0.0068 | 8 |
| 2026-08-28 | 57 | 12.5% | 12.5% | 12.1% | 11.6% | 11.5% | ewma_hl60 | 12.9% | -0.0022 | 14.3% | +0.0045 | 8 |
| 2026-08-29 | 68 | 12.5% | 12.5% | 12.1% | 11.6% | 11.5% | ewma_hl60 | 12.9% | -0.0022 | 14.4% | +0.0045 | 9 |
| 2026-08-30 | 81 | 12.4% | 12.5% | 12.1% | 11.6% | 11.5% | ewma_hl60 | 12.9% | -0.0022 | 14.4% | +0.0045 | 10 |
| 2026-08-31 | 88 | 12.4% | 12.8% | 12.3% | 11.7% | 11.6% | ewma_hl60 | 13.3% | -0.0021 | 15.0% | +0.0061 | 8 |
| 2026-09-01 | 72 | 12.5% | 12.6% | 12.2% | 11.7% | 11.6% | ewma_hl60 | 13.2% | -0.0021 | 14.8% | +0.0054 | 8 |
| 2026-09-02 | 61 | 12.6% | 12.3% | 12.1% | 11.6% | 11.5% | ewma_hl60 | 12.9% | -0.0022 | 14.6% | +0.0044 | 8 |
| 2026-09-03 | 42 | 12.2% | 11.7% | 11.7% | 11.5% | 11.4% | ewma_hl60 | 12.1% | -0.0024 | 13.6% | +0.0011 | 8 |
| 2026-09-04 | 50 | 11.7% | 11.4% | 11.6% | 11.4% | 11.4% | ewma_hl60 | 11.7% | -0.0026 | 12.9% | -0.0012 | 8 |
| 2026-09-05 | 43 | 11.9% | 11.8% | 11.8% | 11.5% | 11.5% | ewma_hl60 | 12.3% | -0.0023 | 13.5% | +0.0009 | 8 |
| 2026-09-06 | 46 | 12.1% | 11.5% | 11.6% | 11.4% | 11.4% | ewma_hl60 | 11.9% | -0.0025 | 12.8% | -0.0013 | 8 |
| 2026-09-07 | 41 | 12.2% | 11.6% | 11.7% | 11.5% | 11.4% | ewma_hl60 | 12.0% | -0.0024 | 12.8% | -0.0014 | 8 |
| 2026-09-08 | 41 | 11.9% | 11.0% | 11.3% | 11.3% | 11.3% | ewma_hl60 | 11.3% | -0.0026 | 11.8% | -0.0047 | 8 |
| 2026-09-09 | 42 | 11.9% | 11.1% | 11.4% | 11.3% | 11.3% | ewma_hl60 | 11.5% | -0.0026 | 11.9% | -0.0042 | 8 |
| 2026-09-10 | 46 | 11.8% | 11.2% | 11.4% | 11.3% | 11.3% | ewma_hl60 | 11.5% | -0.0026 | 11.8% | -0.0042 | 8 |
| 2026-09-11 | 23 | 11.8% | 10.9% | 11.2% | 11.2% | 11.3% | ewma_hl60 | 11.2% | -0.0026 | 11.4% | -0.0055 | 8 |

## Why the winning half-life wins: it looks back further, it is not more responsive

Weighted mean age of the labels each level forecaster actually uses, measured at the last refit day (2026-09-11, label horizon 2026-09-04), plus the effective sample size:

| forecaster | weighted mean label age (days before the horizon) | effective n |
|---|---|---|
| `ewma_hl7` | 9.8 | 594 |
| `ewma_hl14` | 18.7 | 1151 |
| `ewma_hl30` | 34.1 | 2227 |
| `ewma_hl60` | 51.7 | 3605 |
| `prior_30d` | 15.4 | 1807 |
| `prior_all` | 103.6 | 8334 |

Observed H rate by submit week inside the scored period against each level forecaster's mean prediction. Read the columns for responsiveness (how much a forecaster moves) and the rows for level:

| week starting | n | H | observed | `prior_30d` | `ewma_hl7` | `ewma_hl14` | `ewma_hl30` | `ewma_hl60` | `local_linear_trend` | `smooth_trend` |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-23 | 301 | 30 | 10.0% | 12.6% | 12.7% | 12.2% | 11.7% | 11.5% | 13.2% | 14.7% |
| 2026-08-30 | 437 | 40 | 9.2% | 12.3% | 12.3% | 12.0% | 11.6% | 11.5% | 12.7% | 14.3% |
| 2026-09-06 | 239 | 20 | 8.4% | 12.0% | 11.2% | 11.5% | 11.4% | 11.4% | 11.6% | 12.2% |

The winner moves *less* than `prior_30d` over the period, it simply sits lower. Its 30-day rivals average the last month, which was August at 12 to 13%; a 60-day half-life still carries July (9.1% H) and, further back, April (8.1%) and March (4.6%). The gain is a longer, lower memory, not extrapolation - the opposite of the fix this job set out to test.

## Pairwise contrasts (does the ranking add anything on top of a better level?)

Same note-level and day-block bootstrap, but against a reference other than `prior_30d`. Negative favours the first-named forecaster.

| target | contrast | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | log loss diff |
|---|---|---|---|---|---|---|
| H | `stable4_lvl_ewma_sel` vs `ewma_sel` | -0.00024 [-0.00161, +0.00107] | no | [-0.00183, +0.00150] | no | -0.0023 |
| H | `stable4_lvl_ewma_sel` vs `stable4` | -0.00102 [-0.00160, -0.00043] | yes, better | [-0.00159, -0.00045] | yes, better | -0.0042 |
| H | `two_stable4_lvl` vs `stable4_lvl_ewma_sel` | +0.00006 [-0.00057, +0.00077] | no | [-0.00074, +0.00083] | no | +0.0005 |
| H | `two_stable4` vs `stable4` | -0.00036 [-0.00115, +0.00047] | no | [-0.00133, +0.00059] | no | -0.0009 |
| H | `two_ewma` vs `ewma_sel` | +0.00001 [-0.00000, +0.00002] | no | [+0.00000, +0.00001] | yes, worse | +0.0000 |
| NH | `two_stable4` vs `stable4` | -0.00009 [-0.00037, +0.00019] | no | [-0.00036, +0.00018] | no | +0.0025 |
| NH | `two_stable4_lvl` vs `stable4` | -0.00012 [-0.00040, +0.00016] | no | [-0.00036, +0.00013] | no | +0.0021 |
| rated | `ewma_sel` vs `prior_30d` | -0.00051 [-0.00088, -0.00012] | yes, better | [-0.00092, -0.00010] | yes, better | -0.0019 |

## Job 2: one stage versus two stage

`two_prior` = `prior_30d`(rated) x P(H | rated) from the latest 30 available days of rated notes, shrunk to the all-history conditional rate by 100 pseudo-notes (`_m50` / `_m200` are the sensitivities). `two_ewma` uses the selected EWMA level for both factors. `two_stable4` puts the stable4 features on both factors: the rated factor is the plain logistic, the conditional factor is a heavier-L2 logistic (C=0.1) whose intercept is replaced by the shrunk conditional level and whose centred linear predictor is multiplied by lambda = n_rated / (n_rated + 200) (lambda ran 0.34 to 0.56 over the scored days). `two_stable4_lvl` additionally swaps the rated factor's intercept for the selected EWMA level. P(NH) = P(rated) x (1 - P(H | rated)).

**Target H** (positives 90 of 977)

| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? | mean pred / observed | cal-in-large | log loss |
|---|---|---|---|---|---|---|
| `prior_30d` | 0.08450 | ref | - | 12.30% / 9.21% | +3.08pp | 0.3118 |
| `stable4` | 0.08492 | +0.00041 [-0.00119, +0.00196] | no | 13.40% / 9.21% | +4.19pp | 0.3119 |
| `ewma_sel` | 0.08413 | -0.00037 [-0.00068, -0.00006] | yes, better | 11.48% / 9.21% | +2.27pp | 0.3100 |
| `two_prior` | 0.08449 | -0.00001 [-0.00003, +0.00000] | no | 12.29% / 9.21% | +3.07pp | 0.3117 |
| `two_prior_m50` | 0.08450 | -0.00001 [-0.00001, +0.00000] | no | 12.29% / 9.21% | +3.08pp | 0.3118 |
| `two_prior_m200` | 0.08449 | -0.00002 [-0.00004, +0.00001] | no | 12.28% / 9.21% | +3.07pp | 0.3117 |
| `two_ewma` | 0.08414 | -0.00036 [-0.00066, -0.00006] | yes, better | 11.50% / 9.21% | +2.29pp | 0.3101 |
| `two_stable4` | 0.08456 | +0.00005 [-0.00101, +0.00097] | no | 12.79% / 9.21% | +3.58pp | 0.3110 |
| `two_stable4_lvl` | 0.08395 | -0.00055 [-0.00148, +0.00028] | no | 11.75% / 9.21% | +2.54pp | 0.3083 |

**Target NH** (positives 27 of 977)

| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? | mean pred / observed | cal-in-large | log loss |
|---|---|---|---|---|---|---|
| `prior_30d` | 0.02693 | ref | - | 3.39% / 2.76% | +0.62pp | 0.1273 |
| `stable4` | 0.02677 | -0.00016 [-0.00062, +0.00026] | no | 2.87% / 2.76% | +0.10pp | 0.1208 |
| `ewma_sel` | 0.02691 | -0.00001 [-0.00006, +0.00003] | no | 3.37% / 2.76% | +0.61pp | 0.1271 |
| `two_prior` | 0.02693 | +0.00000 [-0.00001, +0.00001] | no | 3.40% / 2.76% | +0.63pp | 0.1273 |
| `two_prior_m50` | 0.02693 | +0.00000 [-0.00000, +0.00000] | no | 3.39% / 2.76% | +0.63pp | 0.1273 |
| `two_prior_m200` | 0.02693 | +0.00000 [-0.00001, +0.00002] | no | 3.40% / 2.76% | +0.64pp | 0.1273 |
| `two_ewma` | 0.02691 | -0.00002 [-0.00006, +0.00003] | no | 3.35% / 2.76% | +0.59pp | 0.1271 |
| `two_stable4` | 0.02668 | -0.00025 [-0.00048, -0.00004] | yes, better | 3.47% / 2.76% | +0.71pp | 0.1233 |
| `two_stable4_lvl` | 0.02665 | -0.00028 [-0.00051, -0.00008] | yes, better | 3.36% / 2.76% | +0.60pp | 0.1228 |

### Conditional factor by day

| day | rated notes in training | P(rated) `prior_30d` | P(H\|rated) shrunk | all-history P(H\|rated) | lambda |
|---|---|---|---|---|---|
| 2026-08-23 | 101 | 16.1% | 77.4% | 77.9% | 0.34 |
| 2026-08-24 | 113 | 16.1% | 77.5% | 78.0% | 0.36 |
| 2026-08-25 | 130 | 16.2% | 78.4% | 78.2% | 0.39 |
| 2026-08-26 | 146 | 16.1% | 78.1% | 78.2% | 0.42 |
| 2026-08-27 | 159 | 16.1% | 78.2% | 78.2% | 0.44 |
| 2026-08-28 | 171 | 16.0% | 78.2% | 78.1% | 0.46 |
| 2026-08-29 | 171 | 16.0% | 78.1% | 78.1% | 0.46 |
| 2026-08-30 | 171 | 16.0% | 77.8% | 78.1% | 0.46 |
| 2026-08-31 | 177 | 16.1% | 77.4% | 78.1% | 0.47 |
| 2026-09-01 | 178 | 16.1% | 77.5% | 78.1% | 0.47 |
| 2026-09-02 | 179 | 16.1% | 78.0% | 78.1% | 0.47 |
| 2026-09-03 | 184 | 15.8% | 77.7% | 78.1% | 0.48 |
| 2026-09-04 | 190 | 15.1% | 77.5% | 78.1% | 0.49 |
| 2026-09-05 | 201 | 15.2% | 78.4% | 78.2% | 0.50 |
| 2026-09-06 | 208 | 15.1% | 79.4% | 78.2% | 0.51 |
| 2026-09-07 | 218 | 15.2% | 80.2% | 78.4% | 0.52 |
| 2026-09-08 | 225 | 14.7% | 80.5% | 78.4% | 0.53 |
| 2026-09-09 | 237 | 14.8% | 80.0% | 78.4% | 0.54 |
| 2026-09-10 | 245 | 14.7% | 80.0% | 78.4% | 0.55 |
| 2026-09-11 | 250 | 14.7% | 79.6% | 78.4% | 0.56 |

## Which features load on which factor

Descriptive, **in-sample, not a forecast**: one unpenalised logistic fit per factor over all 2026 matured window notes (2026-08-07 to 2026-09-11), continuous features standardised within each fitting sample so the coefficients are comparable. `|z| > 2` is the rough flag. The conditional factor has only 288 rows, so its coefficients are noisy; that is exactly why the forecaster shrinks them.

| feature | P(rated), n=2026 | P(H \| rated), n=288 | P(H), n=2026 | P(NH), n=2026 |
|---|---|---|---|---|
| `(intercept)` | -1.499 (z -12.3) | +0.341 (z +1.4) | -2.162 (z -14.3) | -2.489 (z -13.1) |
| `has_earlier` | -0.242 (z -1.7) | +1.954 (z +5.9) | +0.288 (z +1.7) | -1.738 (z -5.9) |
| `age_h` | -0.170 (z -2.5) | -0.224 (z -1.5) | -0.242 (z -3.1) | +0.072 (z +0.6) |
| `feed_missing` | -1.019 (z -1.9) | +7.128 (z +0.2) | -0.457 (z -0.9) | -8.534 (z -0.3) |
| `hist_noH` | -0.371 (z -2.2) | -0.475 (z -1.2) | -0.462 (z -2.4) | -0.034 (z -0.1) |
| `hist_H` | -0.193 (z -1.0) | +0.805 (z +1.4) | -0.098 (z -0.5) | -0.631 (z -1.3) |
| `eval_score` | +0.125 (z +1.8) | +0.261 (z +1.7) | +0.155 (z +1.9) | +0.014 (z +0.1) |
| `eval_missing` | -0.466 (z -1.3) | -0.560 (z -0.6) | -0.529 (z -1.3) | -0.086 (z -0.1) |

### Walk-forward coefficients (mean over the 20 scored refit days)

| factor | `intercept` | `has_earlier` | `age_h` | `feed_missing` | `hist_noH` | `hist_H` | `eval_score` | `eval_missing` |
|---|---|---|---|---|---|---|---|---|
| `H_given_rated` | +1.136 | +0.640 | -0.293 | +0.049 | -0.124 | -0.000 | +0.360 | +0.000 |
| `one_stage_H` | -1.941 | +0.210 | -0.253 | -0.333 | -0.459 | -0.274 | +0.143 | -0.057 |
| `one_stage_NH` | -2.808 | -1.262 | +0.201 | -1.067 | -0.141 | -0.082 | -0.260 | -0.010 |
| `one_stage_rated` | -1.411 | -0.173 | -0.144 | -0.721 | -0.398 | -0.235 | +0.036 | -0.052 |
| `rated` | -1.411 | -0.173 | -0.144 | -0.721 | -0.398 | -0.235 | +0.036 | -0.052 |

(L2-penalised, so these are shrunk; `H_given_rated` uses C=0.1 and its slopes are then further multiplied by lambda before use.)

## Method, settings, leakage notes

Run order: `uv run pretrain.py` (training-period fits), `uv run run.py` (walk-forward predictions),
`uv run report.py` (this file). Everything is offline: the only inputs are the parquet files in
`../2026_09_18_outcome_screen/data/`, read through that folder's own `load()` and `build()`. No database,
no LLM, no external API, and nothing is written outside this folder.

- **Walk-forward.** One refit per UTC calendar day D of submit time; a fit on day D sees only notes with
  submitted_at < D - 7 days. Identical to the prior backtest, and verified identical: `prior_all`,
  `prior_30d` and `stable4` were recomputed here and match the prior run's `predictions.parquet` exactly.
- **`prior_all` / `prior_30d`.** Rate over the whole `notes` table (8,808 rows, back to 2025-10-10) with
  submitted_at < D - 7d; `prior_30d` restricts to the latest 30 label-available days and shrinks by 50
  pseudo-notes of `prior_all`.
- **`ewma_hlX`.** Same history, each note weighted 2^(-age / X days) with age measured from the label
  horizon, shrunk by the same 50 pseudo-notes. Implemented as an exponentially weighted mean of the
  outcome - equivalently the MLE of an intercept-only weighted logistic regression, which is what "on the
  logit scale" means for a binary outcome. It was **not** implemented as an average of daily logits: that
  is a geometric-odds mean, biased downwards by Jensen whenever daily rates are dispersed, which would have
  flattered a forecaster whose whole job here is to chase a falling level. Only the one definition was run.
- **`ewma_sel`.** Whichever half-life the pre-registered rule picked; it is a copy of that row, kept
  separate so the headline is unambiguous.
- **`ewma_auto`.** Re-picks the half-life every refit day, by Brier over every note submitted from
  2026-07-01 up to that day's label horizon, each scored against its own day's walk-forward level. Legal
  (nothing after D - 7d is used) but it is an extra, not the pre-registered headline.
- **`local_linear_trend` / `smooth_trend`.** Kalman filter on the daily logit of the outcome rate over the
  full note history, diffuse prior, Haldane-corrected observations with binomial variances, missing days as
  prediction-only steps. Variances estimated by MLE on days before 2026-08-16 and then fixed. The forecast
  filters up to the label horizon and projects level + steps x slope forward to day D (8 days, sometimes 9
  or 10 after the Aug 21-22 gap).
- **`stable4_lvl_*`.** The stable4 logistic is fitted exactly as before, then every logit is shifted by the
  single constant that makes the mean fitted probability **over the training rows** equal the level
  forecast. Training features only, so the swap uses nothing from the test day.
- **Two-stage.** P(rated) and P(H | rated) fitted separately on the same training rows; the conditional
  factor trains only on rated notes (101 to 250 of them over the scored days). Its level is the 30-day
  conditional rate shrunk to the all-history conditional by 100 pseudo-notes, and its feature slopes are
  a C=0.1 logistic's centred linear predictor multiplied by n_rated / (n_rated + 200), which ran 0.34 to
  0.56. P(NH) = P(rated) x (1 - P(H | rated)); rated is H + NH by construction, so the two conditional
  factors are complementary by definition.

Honesty and residual risks:

1. **Multiplicity.** This run computes 3 targets x 20 forecasters = 60 rows, each with a note-level and a
   day-block interval. At 5% a handful will exclude zero by chance. Nothing here is corrected for that, and
   the pre-registered headline is named in advance precisely so the grid cannot be mined after the fact.
2. **The half-life grid is flat on the training period** (Brier spread 0.00009 across 7/14/30/60 days), so
   the selection rule is close to a coin flip between them. It picked 60 days; the narrow robustness set
   would have picked 7. Both are reported.
3. **`materiality_engages` could not be tested.** The brief asked for it as an extra feature. The offline
   pull (`../2026_09_18_outcome_screen/pull.py`) selected `pipeline_scores` with
   `score_type = 'evaluation'` only, so no `materiality_engages` row exists on disk, and connecting to the
   database was out of scope for this run. `pipeline_runs.ab_test_picks` carries a `materiality_treatment`
   arm on 282 of 2,167 runs, but that is the A/B assignment, not the judge's per-note binary verdict, so it
   is not a substitute. Re-pulling that score type is a one-line change to the sibling pull script and the
   feature split below should be redone with it.
4. **Labels are today's status.** Training labels, the priors and the author-history feature all use
   cn_status at pull time, inherited from the prior run. The screen measured 99.5% of statuses final by day
   7, so this is small but not zero.
5. **Bootstrap intervals treat notes as independent.** Notes share a daily fit and a news cycle; the
   day-block interval is shown alongside and is the one to believe.
6. **The descriptive coefficient table is in-sample** over all 2,026 matured window notes, including the
   977 scored ones. It is a description of where the signal sits, not evidence that it forecasts.

