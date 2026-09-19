# Forecast baselines: walk-forward P(H) and P(NH) at submit time (2026-09-18)
1. **Scored set.** 977 notes submitted 2026-08-23 07:00 to 2026-09-11 18:39 UTC: every matured note from the first refit day with at least 400 label-available training notes (it had 602). H 90 (9.2%), NH 27 (2.8%), rated at all 117 (12.0%). Over the same notes `prior_30d` averaged 12.3% H, 3.4% NH, 15.7% rated. Daily refit; a fit on day D sees only notes submitted before D minus 7 days; all forecasters are scored on the identical 977 notes. Brier difference is forecaster minus `prior_30d` (negative is better), 2,000 note-level bootstrap draws.
<!-- TOP-TABLE-START (metrics.py) -->
| forecaster | H Brier | H skill | H Brier diff vs prior_30d [95%] | excl. 0? | H log loss | H AUC | NH Brier | NH skill | NH Brier diff vs prior_30d [95%] | excl. 0? | NH log loss | NH AUC |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.08450 | +0.0% | -0.00000 [-0.00010, +0.00010] | no | 0.3118 | 0.512 | 0.02691 | +0.1% | -0.00001 [-0.00007, +0.00004] | no | 0.1271 | 0.456 |
| `prior_30d` | 0.08450 | ref | ref | - | 0.3118 | 0.534 | 0.02693 | ref | ref | - | 0.1273 | 0.468 |
| `eval_only` | 0.08480 | -0.3% | +0.00029 [-0.00048, +0.00102] | no | 0.3128 | 0.561 | 0.02724 | -1.2% | +0.00032 [+0.00012, +0.00052] | yes, worse | 0.1307 | 0.474 |
| `stable4` | 0.08492 | -0.5% | +0.00041 [-0.00119, +0.00196] | no | 0.3119 | 0.592 | 0.02677 | +0.6% | -0.00016 [-0.00062, +0.00026] | no | 0.1208 | 0.699 |
| `stable4_no_earlier` | 0.08496 | -0.5% | +0.00046 [-0.00110, +0.00192] | no | 0.3123 | 0.584 | 0.02743 | -1.9% | +0.00051 [+0.00027, +0.00076] | yes, worse | 0.1326 | 0.474 |
| `gbm_canary` | 0.08754 | -3.6% | +0.00303 [+0.00030, +0.00578] | yes, worse | 0.3203 | 0.556 | 0.02840 | -5.5% | +0.00147 [+0.00011, +0.00283] | yes, worse | 0.1323 | 0.603 |
<!-- TOP-TABLE-END -->
2. **Calibration of the best-ranking model, `stable4`.** For H it ranks weakly (AUC 0.59, calibration slope 0.87 [0.24, 1.50]) but predicts 13.4% on average against 9.2% observed, and every quantile bin is over-predicted (top bin 19.2% predicted, 11.7% observed [7.9, 17.0]); `prior_30d` has the same level error (+3.1pp). For NH it is close: 2.9% predicted against 2.8% observed, slope 0.87 [0.37, 1.37], top quintile 6.9% predicted and 7.1% observed (14 of 196).
3. **`stable4` without the earlier-note feature.** For H almost nothing changes (Brier 0.08492 to 0.08496, AUC 0.592 to 0.584). For NH all the skill goes: AUC 0.70 to 0.47, skill +0.6% to -1.9% (that interval excludes zero on the worse side), log loss 0.1208 to 0.1326.
4. **Bottom line.** Nothing beats `prior_30d` on Brier for H or NH (or rated at all): no interval excludes zero on the better side, and `gbm_canary` is worse on all three targets, as expected. The nearest thing to a positive result is `stable4` on NH, where the log loss difference is -0.0065 [-0.0127, -0.0001] while the Brier interval includes zero; it rests on 27 positives, on the feature that lags about 48 hours live, and is one of 81 intervals computed. The larger problem is the level: H fell to 9.2% while every lagged forecaster stayed at 12 to 14%. In hindsight that level error cost `prior_30d` 0.00087 Brier, which is more than `stable4`'s ranking would add with the level corrected (0.00067).

<!-- AUTO-GENERATED BELOW THIS LINE BY metrics.py; edits below are overwritten -->

## Scored set

- Matured window notes (submitted 2026-08-07 or later and before 2026-09-11 19:05 UTC): 2026.
- Scored notes: **977**, every matured note submitted from 2026-08-23 07:00 to 2026-09-11 18:39 UTC. The first scored refit day is 2026-08-23, the first day with at least 400 label-available window notes (it had 602; no notes were submitted on Aug 21-22, and Aug 20 had 369).
- Positives in the scored set: H 90 (9.2%), NH 27 (2.8%), rated at all 117 (12.0%).
- Unscored: 681 notes before the first burn-in day (no prediction made), and 368 burn-in notes (Aug 17-20, 100-399 training notes) that are predicted only so the Platt recalibrator has past predictions to learn from. Neither group enters any metric.
- Missing features inside the scored set: evaluation score 88, feed_tweets join (tweet age and the canary's feed features) 20. These notes are kept and imputed; all forecasters are scored on the identical 977 notes (asserted in code).

Refit schedule (one row per UTC submit day; `n_train` = window notes with submitted_at < day - 7d; `prior_*` use the full note history):

| day | scored | notes that day | n_train | train H | train NH | prior_all H | prior_30d H | n in 30d window | prior_all NH | prior_30d NH |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-17 | burn-in | 85 | 157 | 18 | 4 | 12.1% | 11.6% | 1239 | 3.43% | 3.93% |
| 2026-08-18 | burn-in | 111 | 258 | 33 | 7 | 12.1% | 11.9% | 1317 | 3.42% | 3.56% |
| 2026-08-19 | burn-in | 79 | 310 | 42 | 9 | 12.1% | 12.1% | 1344 | 3.42% | 3.64% |
| 2026-08-20 | burn-in | 93 | 369 | 50 | 12 | 12.2% | 12.2% | 1382 | 3.44% | 3.68% |
| 2026-08-23 | yes | 20 | 602 | 80 | 21 | 12.2% | 12.5% | 1573 | 3.45% | 3.68% |
| 2026-08-24 | yes | 16 | 681 | 90 | 23 | 12.2% | 12.5% | 1645 | 3.44% | 3.64% |
| 2026-08-25 | yes | 19 | 766 | 106 | 24 | 12.3% | 12.7% | 1713 | 3.42% | 3.50% |
| 2026-08-26 | yes | 62 | 877 | 118 | 28 | 12.2% | 12.6% | 1809 | 3.42% | 3.53% |
| 2026-08-27 | yes | 59 | 956 | 128 | 31 | 12.2% | 12.6% | 1875 | 3.42% | 3.52% |
| 2026-08-28 | yes | 57 | 1049 | 137 | 34 | 12.2% | 12.5% | 1949 | 3.42% | 3.49% |
| 2026-08-29 | yes | 68 | 1049 | 137 | 34 | 12.2% | 12.5% | 1933 | 3.42% | 3.52% |
| 2026-08-30 | yes | 81 | 1049 | 137 | 34 | 12.2% | 12.4% | 1908 | 3.42% | 3.56% |
| 2026-08-31 | yes | 88 | 1069 | 141 | 36 | 12.2% | 12.4% | 1905 | 3.44% | 3.67% |
| 2026-09-01 | yes | 72 | 1085 | 142 | 36 | 12.2% | 12.5% | 1857 | 3.43% | 3.66% |
| 2026-09-02 | yes | 61 | 1104 | 143 | 36 | 12.2% | 12.6% | 1805 | 3.42% | 3.54% |
| 2026-09-03 | yes | 42 | 1166 | 147 | 37 | 12.2% | 12.2% | 1830 | 3.41% | 3.55% |
| 2026-09-04 | yes | 50 | 1225 | 152 | 38 | 12.1% | 11.7% | 1807 | 3.39% | 3.43% |
| 2026-09-05 | yes | 43 | 1282 | 161 | 40 | 12.2% | 11.9% | 1782 | 3.40% | 3.26% |
| 2026-09-06 | yes | 46 | 1350 | 167 | 41 | 12.1% | 12.1% | 1776 | 3.38% | 3.05% |
| 2026-09-07 | yes | 41 | 1431 | 177 | 41 | 12.1% | 12.2% | 1789 | 3.35% | 2.92% |
| 2026-09-08 | yes | 41 | 1519 | 183 | 42 | 12.1% | 11.9% | 1825 | 3.32% | 2.76% |
| 2026-09-09 | yes | 42 | 1591 | 192 | 45 | 12.1% | 11.9% | 1852 | 3.33% | 2.87% |
| 2026-09-10 | yes | 46 | 1652 | 199 | 46 | 12.1% | 11.8% | 1854 | 3.32% | 2.87% |
| 2026-09-11 | yes | 23 | 1694 | 202 | 48 | 12.0% | 11.8% | 1807 | 3.32% | 2.94% |

## Metrics, all forecasters and targets

Identical 977 notes in every row. Probabilities clipped to [0.001, 0.999] before every metric. Skill = 1 - Brier / Brier(prior_30d). Differences are forecaster minus prior_30d, so negative is better. Note bootstrap: 2000 resamples of notes, percentile interval, same resamples for every row. Day-block bootstrap: resamples whole submit days (20 days), which allows for notes on the same day sharing a fit and a news cycle; it is the more cautious interval. `_platt` rows are the optional recalibrated versions.

### Target: H  (positives 90 of 977, 9.2%)

| forecaster | Brier | skill vs prior_30d | Brier diff [note bootstrap 95%] | excludes 0? | Brier diff [day-block 95%] | excludes 0? | log loss | log loss diff [95%] | AUC |
|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.08450 | +0.0% | -0.00000 [-0.00010, +0.00010] | no | [-0.00012, +0.00011] | no | 0.3118 | +0.0000 [-0.0004, +0.0005] | 0.512 |
| `prior_30d` | 0.08450 | ref | ref | - | ref | - | 0.3118 | ref | 0.534 |
| `eval_only` | 0.08480 | -0.3% | +0.00029 [-0.00048, +0.00102] | no | [-0.00042, +0.00095] | no | 0.3128 | +0.0010 [-0.0025, +0.0044] | 0.561 |
| `stable4` | 0.08492 | -0.5% | +0.00041 [-0.00119, +0.00196] | no | [-0.00147, +0.00238] | no | 0.3119 | +0.0001 [-0.0067, +0.0068] | 0.592 |
| `stable4_no_earlier` | 0.08496 | -0.5% | +0.00046 [-0.00110, +0.00192] | no | [-0.00131, +0.00232] | no | 0.3123 | +0.0005 [-0.0063, +0.0069] | 0.584 |
| `gbm_canary` | 0.08754 | -3.6% | +0.00303 [+0.00030, +0.00578] | yes, worse | [+0.00079, +0.00529] | yes, worse | 0.3203 | +0.0085 [-0.0016, +0.0195] | 0.556 |
| `eval_only_platt` | 0.08834 | -4.5% | +0.00383 [+0.00201, +0.00579] | yes, worse | [+0.00169, +0.00600] | yes, worse | 0.3259 | +0.0141 [+0.0068, +0.0219] | 0.446 |
| `stable4_platt` | 0.08467 | -0.2% | +0.00016 [-0.00065, +0.00093] | no | [-0.00051, +0.00110] | no | 0.3119 | +0.0001 [-0.0032, +0.0033] | 0.556 |
| `stable4_no_earlier_platt` | 0.08481 | -0.4% | +0.00030 [-0.00045, +0.00101] | no | [-0.00031, +0.00106] | no | 0.3125 | +0.0007 [-0.0024, +0.0039] | 0.507 |
| `gbm_canary_platt` | 0.08480 | -0.4% | +0.00030 [-0.00100, +0.00149] | no | [-0.00038, +0.00121] | no | 0.3121 | +0.0003 [-0.0044, +0.0048] | 0.559 |

### Target: NH  (positives 27 of 977, 2.8%)

| forecaster | Brier | skill vs prior_30d | Brier diff [note bootstrap 95%] | excludes 0? | Brier diff [day-block 95%] | excludes 0? | log loss | log loss diff [95%] | AUC |
|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.02691 | +0.1% | -0.00001 [-0.00007, +0.00004] | no | [-0.00006, +0.00004] | no | 0.1271 | -0.0002 [-0.0010, +0.0006] | 0.456 |
| `prior_30d` | 0.02693 | ref | ref | - | ref | - | 0.1273 | ref | 0.468 |
| `eval_only` | 0.02724 | -1.2% | +0.00032 [+0.00012, +0.00052] | yes, worse | [+0.00008, +0.00061] | yes, worse | 0.1307 | +0.0034 [+0.0001, +0.0072] | 0.474 |
| `stable4` | 0.02677 | +0.6% | -0.00016 [-0.00062, +0.00026] | no | [-0.00050, +0.00013] | no | 0.1208 | -0.0065 [-0.0127, -0.0001] | 0.699 |
| `stable4_no_earlier` | 0.02743 | -1.9% | +0.00051 [+0.00027, +0.00076] | yes, worse | [+0.00013, +0.00093] | yes, worse | 0.1326 | +0.0053 [+0.0010, +0.0100] | 0.474 |
| `gbm_canary` | 0.02840 | -5.5% | +0.00147 [+0.00011, +0.00283] | yes, worse | [+0.00023, +0.00266] | yes, worse | 0.1323 | +0.0050 [-0.0060, +0.0156] | 0.603 |
| `eval_only_platt` | 0.02713 | -0.7% | +0.00020 [+0.00003, +0.00040] | yes, worse | [+0.00002, +0.00043] | yes, worse | 0.1290 | +0.0017 [-0.0012, +0.0051] | 0.545 |
| `stable4_platt` | 0.02681 | +0.4% | -0.00012 [-0.00049, +0.00022] | no | [-0.00038, +0.00013] | no | 0.1219 | -0.0054 [-0.0104, -0.0002] | 0.698 |
| `stable4_no_earlier_platt` | 0.02721 | -1.0% | +0.00028 [+0.00008, +0.00050] | yes, worse | [+0.00001, +0.00060] | yes, worse | 0.1292 | +0.0019 [-0.0014, +0.0057] | 0.553 |
| `gbm_canary_platt` | 0.02825 | -4.9% | +0.00132 [+0.00004, +0.00265] | yes, worse | [+0.00015, +0.00243] | yes, worse | 0.1295 | +0.0022 [-0.0069, +0.0116] | 0.639 |

### Target: rated  (positives 117 of 977, 12.0%)

| forecaster | Brier | skill vs prior_30d | Brier diff [note bootstrap 95%] | excludes 0? | Brier diff [day-block 95%] | excludes 0? | log loss | log loss diff [95%] | AUC |
|---|---|---|---|---|---|---|---|---|---|
| `prior_all` | 0.10670 | +0.0% | -0.00004 [-0.00022, +0.00014] | no | [-0.00030, +0.00028] | no | 0.3717 | -0.0001 [-0.0008, +0.0006] | 0.486 |
| `prior_30d` | 0.10674 | ref | ref | - | ref | - | 0.3718 | ref | 0.512 |
| `eval_only` | 0.10690 | -0.1% | +0.00016 [-0.00022, +0.00057] | no | [-0.00025, +0.00054] | no | 0.3723 | +0.0006 [-0.0009, +0.0021] | 0.541 |
| `stable4` | 0.10639 | +0.3% | -0.00034 [-0.00165, +0.00089] | no | [-0.00169, +0.00101] | no | 0.3694 | -0.0024 [-0.0071, +0.0022] | 0.579 |
| `stable4_no_earlier` | 0.10663 | +0.1% | -0.00010 [-0.00134, +0.00108] | no | [-0.00146, +0.00131] | no | 0.3704 | -0.0014 [-0.0058, +0.0029] | 0.572 |
| `gbm_canary` | 0.11227 | -5.2% | +0.00553 [+0.00235, +0.00893] | yes, worse | [+0.00277, +0.00845] | yes, worse | 0.3871 | +0.0153 [+0.0055, +0.0259] | 0.525 |
| `eval_only_platt` | 0.10698 | -0.2% | +0.00024 [-0.00079, +0.00135] | no | [-0.00064, +0.00114] | no | 0.3727 | +0.0009 [-0.0033, +0.0054] | 0.450 |
| `stable4_platt` | 0.10693 | -0.2% | +0.00019 [-0.00053, +0.00088] | no | [-0.00055, +0.00096] | no | 0.3720 | +0.0003 [-0.0024, +0.0030] | 0.495 |
| `stable4_no_earlier_platt` | 0.10696 | -0.2% | +0.00022 [-0.00052, +0.00097] | no | [-0.00055, +0.00101] | no | 0.3722 | +0.0004 [-0.0023, +0.0033] | 0.487 |
| `gbm_canary_platt` | 0.10827 | -1.4% | +0.00153 [+0.00003, +0.00305] | yes, worse | [+0.00002, +0.00405] | yes, worse | 0.3762 | +0.0044 [-0.0008, +0.0099] | 0.507 |

## Hindsight ceilings (NOT forecasts)

These rows use the scored outcomes themselves, so none of them is a legal forecast. They size what was on the table. `constant at observed rate` is the best any single number could do. `level fixed` adds one constant to a model's logits, fitted on the scored set, so the ranking and spread are the model's own and only the base-rate error is removed. `level and slope fixed` also rescales the logits (in-sample Platt, 2 parameters, slightly optimistic).

| target | row | Brier | vs prior_30d | vs constant at observed rate | log loss |
|---|---|---|---|---|---|
| H | `prior_30d` as forecast (legal) | 0.08450 | ref | +0.00087 | 0.3118 |
| H | constant at observed rate | 0.08363 | -0.00087 | ref | 0.3074 |
| H | `eval_only`, level fixed | 0.08339 | -0.00112 | -0.00025 | 0.3060 |
| H | `eval_only`, level and slope fixed | 0.08339 | -0.00112 | -0.00025 | 0.3060 |
| H | `stable4`, level fixed | 0.08297 | -0.00154 | -0.00067 | 0.3035 |
| H | `stable4`, level and slope fixed | 0.08296 | -0.00155 | -0.00068 | 0.3034 |
| H | `stable4_no_earlier`, level fixed | 0.08307 | -0.00143 | -0.00056 | 0.3042 |
| H | `stable4_no_earlier`, level and slope fixed | 0.08306 | -0.00145 | -0.00058 | 0.3040 |
| H | `gbm_canary`, level fixed | 0.08412 | -0.00039 | +0.00048 | 0.3103 |
| H | `gbm_canary`, level and slope fixed | 0.08332 | -0.00119 | -0.00032 | 0.3057 |
| NH | `prior_30d` as forecast (legal) | 0.02693 | ref | +0.00006 | 0.1273 |
| NH | constant at observed rate | 0.02687 | -0.00006 | ref | 0.1264 |
| NH | `eval_only`, level fixed | 0.02719 | +0.00026 | +0.00031 | 0.1306 |
| NH | `eval_only`, level and slope fixed | 0.02685 | -0.00008 | -0.00002 | 0.1256 |
| NH | `stable4`, level fixed | 0.02675 | -0.00018 | -0.00012 | 0.1207 |
| NH | `stable4`, level and slope fixed | 0.02668 | -0.00025 | -0.00020 | 0.1206 |
| NH | `stable4_no_earlier`, level fixed | 0.02734 | +0.00042 | +0.00047 | 0.1324 |
| NH | `stable4_no_earlier`, level and slope fixed | 0.02686 | -0.00007 | -0.00001 | 0.1259 |
| NH | `gbm_canary`, level fixed | 0.02780 | +0.00087 | +0.00093 | 0.1314 |
| NH | `gbm_canary`, level and slope fixed | 0.02677 | -0.00016 | -0.00010 | 0.1247 |
| rated | `prior_30d` as forecast (legal) | 0.10674 | ref | +0.00132 | 0.3718 |
| rated | constant at observed rate | 0.10541 | -0.00132 | ref | 0.3664 |
| rated | `eval_only`, level fixed | 0.10530 | -0.00144 | -0.00011 | 0.3659 |
| rated | `eval_only`, level and slope fixed | 0.10530 | -0.00144 | -0.00012 | 0.3659 |
| rated | `stable4`, level fixed | 0.10457 | -0.00217 | -0.00084 | 0.3621 |
| rated | `stable4`, level and slope fixed | 0.10457 | -0.00217 | -0.00085 | 0.3619 |
| rated | `stable4_no_earlier`, level fixed | 0.10472 | -0.00202 | -0.00070 | 0.3628 |
| rated | `stable4_no_earlier`, level and slope fixed | 0.10472 | -0.00202 | -0.00070 | 0.3627 |
| rated | `gbm_canary`, level fixed | 0.10704 | +0.00030 | +0.00163 | 0.3742 |
| rated | `gbm_canary`, level and slope fixed | 0.10531 | -0.00143 | -0.00010 | 0.3660 |

## Calibration summary and sharpness

Calibration-in-the-large = mean predicted minus observed rate. Slope = unpenalised logistic regression of the outcome on logit(prediction), Wald 95% interval; 1.0 is ideal, below 1 means the predictions are too spread out. For the two priors the predictions barely vary, so their slope is not informative. Sharpness = 10th to 90th percentile of the predictions.

| target | forecaster | mean predicted | observed | predicted minus observed | calibration slope [95%] | sharpness p10 to p90 |
|---|---|---|---|---|---|---|
| H | `prior_all` | 12.18% | 9.21% | +2.97pp | 22.09 [-18.57, 62.75] | 12.1% to 12.2% |
| H | `prior_30d` | 12.30% | 9.21% | +3.08pp | 6.65 [-1.52, 14.82] | 11.8% to 12.6% |
| H | `eval_only` | 12.94% | 9.21% | +3.73pp | 1.00 [-0.21, 2.21] | 9.7% to 15.3% |
| H | `stable4` | 13.40% | 9.21% | +4.19pp | 0.87 [0.24, 1.50] | 8.2% to 18.9% |
| H | `stable4_no_earlier` | 13.31% | 9.21% | +4.10pp | 0.81 [0.17, 1.45] | 8.1% to 18.4% |
| H | `gbm_canary` | 13.77% | 9.21% | +4.56pp | 0.38 [-0.02, 0.78] | 6.8% to 22.0% |
| H | `eval_only_platt` | 12.66% | 9.21% | +3.45pp | -0.44 [-1.03, 0.15] | 7.7% to 18.5% |
| H | `stable4_platt` | 12.51% | 9.21% | +3.29pp | 0.81 [-0.32, 1.93] | 10.6% to 13.6% |
| H | `stable4_no_earlier_platt` | 12.48% | 9.21% | +3.27pp | 0.58 [-0.60, 1.76] | 10.6% to 13.8% |
| H | `gbm_canary_platt` | 12.58% | 9.21% | +3.37pp | 0.67 [-0.14, 1.49] | 10.1% to 14.2% |
| NH | `prior_all` | 3.40% | 2.76% | +0.64pp | -6.45 [-36.94, 24.04] | 3.3% to 3.4% |
| NH | `prior_30d` | 3.39% | 2.76% | +0.62pp | -0.55 [-4.53, 3.44] | 2.9% to 3.7% |
| NH | `eval_only` | 3.07% | 2.76% | +0.30pp | -0.77 [-2.04, 0.50] | 2.1% to 5.0% |
| NH | `stable4` | 2.87% | 2.76% | +0.10pp | 0.87 [0.37, 1.37] | 1.1% to 6.4% |
| NH | `stable4_no_earlier` | 3.08% | 2.76% | +0.32pp | -0.42 [-1.26, 0.42] | 1.6% to 5.5% |
| NH | `gbm_canary` | 3.49% | 2.76% | +0.72pp | 0.35 [-0.01, 0.72] | 0.8% to 7.7% |
| NH | `eval_only_platt` | 2.93% | 2.76% | +0.17pp | -0.27 [-1.50, 0.95] | 2.1% to 4.4% |
| NH | `stable4_platt` | 2.81% | 2.76% | +0.05pp | 0.89 [0.32, 1.46] | 1.3% to 5.5% |
| NH | `stable4_no_earlier_platt` | 2.98% | 2.76% | +0.21pp | 0.00 [-0.91, 0.91] | 1.8% to 4.9% |
| NH | `gbm_canary_platt` | 3.56% | 2.76% | +0.80pp | 0.44 [0.03, 0.84] | 0.9% to 6.9% |
| rated | `prior_all` | 15.58% | 11.98% | +3.60pp | 7.15 [-19.60, 33.89] | 15.4% to 15.7% |
| rated | `prior_30d` | 15.68% | 11.98% | +3.71pp | 1.69 [-2.98, 6.35] | 14.7% to 16.1% |
| rated | `eval_only` | 15.98% | 11.98% | +4.00pp | 1.15 [-1.10, 3.41] | 14.6% to 17.2% |
| rated | `stable4` | 16.27% | 11.98% | +4.29pp | 1.23 [0.40, 2.06] | 12.1% to 20.4% |
| rated | `stable4_no_earlier` | 16.36% | 11.98% | +4.38pp | 1.19 [0.30, 2.09] | 12.4% to 20.3% |
| rated | `gbm_canary` | 17.70% | 11.98% | +5.73pp | 0.19 [-0.21, 0.59] | 10.0% to 27.3% |
| rated | `eval_only_platt` | 14.31% | 11.98% | +2.33pp | -1.03 [-2.32, 0.25] | 12.1% to 17.0% |
| rated | `stable4_platt` | 15.18% | 11.98% | +3.20pp | -0.06 [-1.34, 1.23] | 13.5% to 17.5% |
| rated | `stable4_no_earlier_platt` | 15.10% | 11.98% | +3.12pp | -0.17 [-1.44, 1.10] | 13.5% to 17.6% |
| rated | `gbm_canary_platt` | 15.42% | 11.98% | +3.45pp | -0.22 [-1.02, 0.59] | 13.4% to 16.7% |

## Drift inside the scored set (target H)

Observed H rate against each forecaster's mean prediction, by submit week. Shows how far the lagged base rate trails the outcome.

| week starting | n | H | observed | `prior_all` | `prior_30d` | `eval_only` | `stable4` | `stable4_no_earlier` | `gbm_canary` |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-23 | 301 | 30 | 10.0% [7.1%, 13.9%] | 12.2% | 12.6% | 13.6% | 14.2% | 14.1% | 15.0% |
| 2026-08-30 | 437 | 40 | 9.2% [6.8%, 12.2%] | 12.2% | 12.3% | 12.9% | 13.2% | 13.1% | 13.8% |
| 2026-09-06 | 239 | 20 | 8.4% [5.5%, 12.6%] | 12.1% | 12.0% | 12.1% | 12.7% | 12.6% | 12.1% |

## Platt recalibration coverage

On refit day D the recalibrator is fitted on earlier walk-forward predictions for notes submitted before D - 7d, and only once it has at least 300 of them with at least 15 positives; before that the `_platt` row equals the raw model.

| target | forecaster | scored notes with recalibration active |
|---|---|---|
| H | `eval_only_platt` | 801 of 977 |
| H | `gbm_canary_platt` | 801 of 977 |
| H | `stable4_no_earlier_platt` | 801 of 977 |
| H | `stable4_platt` | 801 of 977 |
| NH | `eval_only_platt` | 332 of 977 |
| NH | `gbm_canary_platt` | 332 of 977 |
| NH | `stable4_no_earlier_platt` | 332 of 977 |
| NH | `stable4_platt` | 332 of 977 |
| rated | `eval_only_platt` | 801 of 977 |
| rated | `gbm_canary_platt` | 801 of 977 |
| rated | `stable4_no_earlier_platt` | 801 of 977 |
| rated | `stable4_platt` | 801 of 977 |

## Calibration tables

Observed-rate intervals are Wilson 95%. Quantile bins are 5 equal-count bins of that forecaster's own predictions (fewer when ties collapse bin edges, as for the priors). † marks n < 30.

### H / `prior_all`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 12.0-12.1% | 198 | 12.1% | 7.6% | 15 | [4.6%, 12.1%] |
| 12.1-12.2% | 196 | 12.1% | 8.7% | 17 | [5.5%, 13.5%] |
| 12.2-12.2% | 283 | 12.2% | 11.7% | 33 | [8.4%, 15.9%] |
| 12.2-12.2% | 160 | 12.2% | 9.4% | 15 | [5.8%, 14.9%] |
| 12.2-12.3% | 140 | 12.2% | 7.1% | 10 | [3.9%, 12.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 10-15% | 977 | 12.2% | 9.2% | 90 | [7.6%, 11.2%] |

### H / `prior_30d`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 11.6-11.9% | 202 | 11.8% | 5.4% | 11 | [3.1%, 9.5%] |
| 11.9-12.4% | 253 | 12.2% | 10.7% | 27 | [7.4%, 15.1%] |
| 12.4-12.5% | 196 | 12.5% | 10.2% | 20 | [6.7%, 15.2%] |
| 12.5-12.6% | 186 | 12.5% | 11.8% | 22 | [7.9%, 17.3%] |
| 12.6-12.7% | 140 | 12.6% | 7.1% | 10 | [3.9%, 12.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 10-15% | 977 | 12.3% | 9.2% | 90 | [7.6%, 11.2%] |

### H / `eval_only`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 7.2-11.2% | 196 | 9.6% | 8.2% | 16 | [5.1%, 12.8%] |
| 11.2-12.7% | 195 | 12.2% | 6.2% | 12 | [3.6%, 10.4%] |
| 12.7-13.8% | 195 | 13.3% | 9.7% | 19 | [6.3%, 14.7%] |
| 13.8-14.8% | 195 | 14.3% | 9.7% | 19 | [6.3%, 14.7%] |
| 14.8-16.4% | 196 | 15.4% | 12.2% | 24 | [8.4%, 17.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% | 115 | 8.9% | 7.8% | 9 | [4.2%, 14.2%] |
| 10-15% | 708 | 13.0% | 8.5% | 60 | [6.6%, 10.8%] |
| 15-25% | 154 | 15.5% | 13.6% | 21 | [9.1%, 19.9%] |

### H / `stable4`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 4.1-9.6% | 196 | 7.9% | 6.6% | 13 | [3.9%, 11.0%] |
| 9.6-12.1% | 195 | 10.9% | 5.6% | 11 | [3.2%, 9.8%] |
| 12.1-14.5% | 195 | 13.3% | 9.7% | 19 | [6.3%, 14.7%] |
| 14.5-17.2% | 195 | 15.7% | 12.3% | 24 | [8.4%, 17.7%] |
| 17.2-23.6% | 196 | 19.2% | 11.7% | 23 | [7.9%, 17.0%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% † | 5 | 4.5% | 20.0% | 1 | [3.6%, 62.4%] |
| 5-10% | 219 | 8.2% | 5.9% | 13 | [3.5%, 9.9%] |
| 10-15% | 402 | 12.5% | 8.2% | 33 | [5.9%, 11.3%] |
| 15-25% | 351 | 17.8% | 12.3% | 43 | [9.2%, 16.1%] |

### H / `stable4_no_earlier`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 4.0-9.7% | 196 | 7.8% | 5.1% | 10 | [2.8%, 9.1%] |
| 9.7-12.2% | 195 | 11.0% | 7.2% | 14 | [4.3%, 11.7%] |
| 12.2-14.4% | 195 | 13.2% | 8.7% | 17 | [5.5%, 13.5%] |
| 14.4-16.9% | 195 | 15.6% | 14.4% | 28 | [10.1%, 20.0%] |
| 16.9-22.7% | 196 | 18.9% | 10.7% | 21 | [7.1%, 15.8%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% † | 4 | 4.5% | 25.0% | 1 | [4.6%, 69.9%] |
| 5-10% | 211 | 8.1% | 5.2% | 11 | [2.9%, 9.1%] |
| 10-15% | 426 | 12.5% | 8.9% | 38 | [6.6%, 12.0%] |
| 15-25% | 336 | 17.7% | 11.9% | 40 | [8.9%, 15.8%] |

### H / `gbm_canary`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 2.8-9.0% | 196 | 6.6% | 6.1% | 12 | [3.5%, 10.4%] |
| 9.0-11.3% | 195 | 10.1% | 10.8% | 21 | [7.2%, 15.9%] |
| 11.3-14.2% | 195 | 12.6% | 6.7% | 13 | [3.9%, 11.1%] |
| 14.2-18.0% | 195 | 15.8% | 9.7% | 19 | [6.3%, 14.7%] |
| 18.0-46.0% | 196 | 23.8% | 12.8% | 25 | [8.8%, 18.2%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 37 | 4.2% | 5.4% | 2 | [1.5%, 17.7%] |
| 5-10% | 240 | 7.9% | 8.3% | 20 | [5.5%, 12.5%] |
| 10-15% | 365 | 12.3% | 7.4% | 27 | [5.1%, 10.5%] |
| 15-25% | 279 | 18.6% | 12.5% | 35 | [9.2%, 16.9%] |
| 25%+ | 56 | 31.2% | 10.7% | 6 | [5.0%, 21.5%] |

### H / `eval_only_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 6.6-8.9% | 196 | 7.8% | 12.2% | 24 | [8.4%, 17.6%] |
| 8.9-10.9% | 195 | 9.9% | 10.3% | 20 | [6.7%, 15.3%] |
| 10.9-12.5% | 209 | 11.6% | 6.7% | 14 | [4.0%, 10.9%] |
| 12.5-15.1% | 181 | 13.7% | 8.8% | 16 | [5.5%, 13.9%] |
| 15.1-33.2% | 196 | 20.4% | 8.2% | 16 | [5.1%, 12.8%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% | 291 | 8.3% | 12.4% | 36 | [9.1%, 16.7%] |
| 10-15% | 483 | 12.1% | 7.9% | 38 | [5.8%, 10.6%] |
| 15-25% | 163 | 18.1% | 7.4% | 12 | [4.3%, 12.4%] |
| 25%+ | 40 | 29.0% | 10.0% | 4 | [4.0%, 23.1%] |

### H / `stable4_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 4.1-11.3% | 196 | 10.1% | 6.6% | 13 | [3.9%, 11.0%] |
| 11.3-12.1% | 195 | 11.7% | 9.7% | 19 | [6.3%, 14.7%] |
| 12.1-12.7% | 195 | 12.5% | 7.7% | 15 | [4.7%, 12.3%] |
| 12.7-13.2% | 195 | 13.0% | 10.8% | 21 | [7.2%, 15.9%] |
| 13.2-23.6% | 196 | 15.3% | 11.2% | 22 | [7.5%, 16.4%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% † | 1 | 4.2% | 0.0% | 0 | [0.0%, 79.3%] |
| 5-10% | 63 | 8.8% | 6.3% | 4 | [2.5%, 15.2%] |
| 10-15% | 839 | 12.3% | 9.4% | 79 | [7.6%, 11.6%] |
| 15-25% | 74 | 18.2% | 9.5% | 7 | [4.7%, 18.3%] |

### H / `stable4_no_earlier_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 4.0-11.3% | 196 | 10.3% | 6.6% | 13 | [3.9%, 11.0%] |
| 11.3-12.1% | 195 | 11.7% | 9.2% | 18 | [5.9%, 14.1%] |
| 12.1-12.7% | 195 | 12.5% | 14.9% | 29 | [10.6%, 20.5%] |
| 12.7-13.0% | 195 | 12.8% | 9.2% | 18 | [5.9%, 14.1%] |
| 13.0-22.7% | 196 | 15.2% | 6.1% | 12 | [3.5%, 10.4%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% † | 1 | 4.1% | 0.0% | 0 | [0.0%, 79.3%] |
| 5-10% | 55 | 8.8% | 5.5% | 3 | [1.9%, 14.9%] |
| 10-15% | 844 | 12.2% | 9.2% | 78 | [7.5%, 11.4%] |
| 15-25% | 77 | 17.9% | 11.7% | 9 | [6.3%, 20.7%] |

### H / `gbm_canary_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 3.5-11.0% | 196 | 9.5% | 7.1% | 14 | [4.3%, 11.6%] |
| 11.0-12.0% | 195 | 11.5% | 6.7% | 13 | [3.9%, 11.1%] |
| 12.0-12.7% | 195 | 12.4% | 10.8% | 21 | [7.2%, 15.9%] |
| 12.7-13.5% | 195 | 13.1% | 9.7% | 19 | [6.3%, 14.7%] |
| 13.5-38.9% | 196 | 16.3% | 11.7% | 23 | [7.9%, 17.0%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% † | 4 | 4.0% | 0.0% | 0 | [0.0%, 49.0%] |
| 5-10% | 91 | 8.6% | 5.5% | 5 | [2.4%, 12.2%] |
| 10-15% | 813 | 12.4% | 9.6% | 78 | [7.8%, 11.8%] |
| 15-25% | 57 | 18.9% | 8.8% | 5 | [3.8%, 18.9%] |
| 25%+ † | 12 | 29.3% | 16.7% | 2 | [4.7%, 44.8%] |

### NH / `prior_all`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 3.3-3.4% | 239 | 3.3% | 3.3% | 8 | [1.7%, 6.5%] |
| 3.4-3.4% | 154 | 3.4% | 4.5% | 7 | [2.2%, 9.1%] |
| 3.4-3.4% | 268 | 3.4% | 1.5% | 4 | [0.6%, 3.8%] |
| 3.4-3.4% | 120 | 3.4% | 1.7% | 2 | [0.5%, 5.9%] |
| 3.4-3.5% | 196 | 3.4% | 3.1% | 6 | [1.4%, 6.5%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 977 | 3.4% | 2.8% | 27 | [1.9%, 4.0%] |

### NH / `prior_30d`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 2.7-3.0% | 239 | 2.9% | 3.3% | 8 | [1.7%, 6.5%] |
| 3.0-3.5% | 169 | 3.4% | 4.1% | 7 | [2.0%, 8.3%] |
| 3.5-3.5% | 189 | 3.5% | 1.6% | 3 | [0.5%, 4.6%] |
| 3.5-3.6% | 184 | 3.6% | 1.6% | 3 | [0.6%, 4.7%] |
| 3.6-3.7% | 196 | 3.7% | 3.1% | 6 | [1.4%, 6.5%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 977 | 3.4% | 2.8% | 27 | [1.9%, 4.0%] |

### NH / `eval_only`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 1.5-2.2% | 196 | 2.1% | 2.0% | 4 | [0.8%, 5.1%] |
| 2.2-2.5% | 195 | 2.3% | 2.6% | 5 | [1.1%, 5.9%] |
| 2.5-2.7% | 195 | 2.6% | 4.1% | 8 | [2.1%, 7.9%] |
| 2.7-3.8% | 195 | 3.1% | 4.1% | 8 | [2.1%, 7.9%] |
| 3.8-11.1% | 196 | 5.3% | 1.0% | 2 | [0.3%, 3.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 876 | 2.7% | 3.1% | 27 | [2.1%, 4.4%] |
| 5-10% | 99 | 6.1% | 0.0% | 0 | [0.0%, 3.7%] |
| 10-15% † | 2 | 10.9% | 0.0% | 0 | [0.0%, 65.8%] |

### NH / `stable4`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.3-1.3% | 196 | 1.1% | 0.5% | 1 | [0.1%, 2.8%] |
| 1.3-1.5% | 195 | 1.4% | 1.5% | 3 | [0.5%, 4.4%] |
| 1.5-2.1% | 195 | 1.8% | 1.5% | 3 | [0.5%, 4.4%] |
| 2.1-4.6% | 195 | 3.2% | 3.1% | 6 | [1.4%, 6.5%] |
| 4.6-14.4% | 196 | 6.9% | 7.1% | 14 | [4.3%, 11.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 808 | 2.0% | 2.2% | 18 | [1.4%, 3.5%] |
| 5-10% | 154 | 6.8% | 5.8% | 9 | [3.1%, 10.7%] |
| 10-15% † | 15 | 11.7% | 0.0% | 0 | [0.0%, 20.4%] |

### NH / `stable4_no_earlier`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.6-1.9% | 196 | 1.6% | 1.5% | 3 | [0.5%, 4.4%] |
| 1.9-2.2% | 195 | 2.0% | 3.1% | 6 | [1.4%, 6.5%] |
| 2.2-2.8% | 195 | 2.5% | 5.1% | 10 | [2.8%, 9.2%] |
| 2.8-4.0% | 195 | 3.4% | 3.1% | 6 | [1.4%, 6.5%] |
| 4.0-11.9% | 196 | 5.9% | 1.0% | 2 | [0.3%, 3.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 854 | 2.5% | 3.0% | 26 | [2.1%, 4.4%] |
| 5-10% | 115 | 6.5% | 0.9% | 1 | [0.2%, 4.8%] |
| 10-15% † | 8 | 10.9% | 0.0% | 0 | [0.0%, 32.4%] |

### NH / `gbm_canary`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.2-1.0% | 196 | 0.8% | 1.0% | 2 | [0.3%, 3.6%] |
| 1.0-1.5% | 195 | 1.2% | 3.1% | 6 | [1.4%, 6.5%] |
| 1.5-2.4% | 195 | 1.9% | 2.1% | 4 | [0.8%, 5.2%] |
| 2.4-4.7% | 195 | 3.4% | 3.1% | 6 | [1.4%, 6.5%] |
| 4.7-50.3% | 196 | 10.2% | 4.6% | 9 | [2.4%, 8.5%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 795 | 1.9% | 2.4% | 19 | [1.5%, 3.7%] |
| 5-10% | 114 | 6.8% | 2.6% | 3 | [0.9%, 7.5%] |
| 10-15% | 39 | 11.8% | 10.3% | 4 | [4.1%, 23.6%] |
| 15-25% † | 22 | 19.2% | 4.5% | 1 | [0.8%, 21.8%] |
| 25%+ † | 7 | 38.7% | 0.0% | 0 | [0.0%, 35.4%] |

### NH / `eval_only_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 1.4-2.2% | 196 | 2.0% | 2.0% | 4 | [0.8%, 5.1%] |
| 2.2-2.5% | 233 | 2.3% | 1.7% | 4 | [0.7%, 4.3%] |
| 2.5-2.7% | 157 | 2.6% | 2.5% | 4 | [1.0%, 6.4%] |
| 2.7-3.2% | 195 | 2.9% | 6.2% | 12 | [3.6%, 10.4%] |
| 3.2-11.1% | 196 | 4.9% | 1.5% | 3 | [0.5%, 4.4%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 898 | 2.6% | 3.0% | 27 | [2.1%, 4.3%] |
| 5-10% | 77 | 6.2% | 0.0% | 0 | [0.0%, 4.8%] |
| 10-15% † | 2 | 10.9% | 0.0% | 0 | [0.0%, 65.8%] |

### NH / `stable4_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.3-1.4% | 196 | 1.2% | 0.5% | 1 | [0.1%, 2.8%] |
| 1.4-1.8% | 195 | 1.6% | 1.0% | 2 | [0.3%, 3.7%] |
| 1.8-2.3% | 195 | 2.0% | 2.1% | 4 | [0.8%, 5.2%] |
| 2.3-3.9% | 195 | 3.0% | 5.6% | 11 | [3.2%, 9.8%] |
| 3.9-14.2% | 196 | 6.2% | 4.6% | 9 | [2.4%, 8.5%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 857 | 2.2% | 2.5% | 21 | [1.6%, 3.7%] |
| 5-10% | 108 | 6.8% | 5.6% | 6 | [2.6%, 11.6%] |
| 10-15% † | 12 | 11.6% | 0.0% | 0 | [0.0%, 24.2%] |

### NH / `stable4_no_earlier_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.6-2.1% | 196 | 1.7% | 1.0% | 2 | [0.3%, 3.6%] |
| 2.1-2.4% | 195 | 2.3% | 2.1% | 4 | [0.8%, 5.2%] |
| 2.4-2.7% | 195 | 2.5% | 4.1% | 8 | [2.1%, 7.9%] |
| 2.7-3.5% | 195 | 2.9% | 4.6% | 9 | [2.4%, 8.5%] |
| 3.5-11.9% | 196 | 5.4% | 2.0% | 4 | [0.8%, 5.1%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 880 | 2.6% | 3.0% | 26 | [2.0%, 4.3%] |
| 5-10% | 90 | 6.5% | 1.1% | 1 | [0.2%, 6.0%] |
| 10-15% † | 7 | 10.8% | 0.0% | 0 | [0.0%, 35.4%] |

### NH / `gbm_canary_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0.2-1.2% | 196 | 0.9% | 1.5% | 3 | [0.5%, 4.4%] |
| 1.2-2.3% | 195 | 1.9% | 0.5% | 1 | [0.1%, 2.8%] |
| 2.3-2.7% | 195 | 2.5% | 3.1% | 6 | [1.4%, 6.5%] |
| 2.7-4.1% | 195 | 3.1% | 5.1% | 10 | [2.8%, 9.2%] |
| 4.1-50.3% | 196 | 9.5% | 3.6% | 7 | [1.7%, 7.2%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 0-5% | 826 | 2.2% | 2.5% | 21 | [1.7%, 3.9%] |
| 5-10% | 94 | 6.9% | 2.1% | 2 | [0.6%, 7.4%] |
| 10-15% | 31 | 11.9% | 9.7% | 3 | [3.3%, 24.9%] |
| 15-25% † | 19 | 19.4% | 5.3% | 1 | [0.9%, 24.6%] |
| 25%+ † | 7 | 38.7% | 0.0% | 0 | [0.0%, 35.4%] |

### rated / `prior_all`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 15.4-15.5% | 239 | 15.4% | 11.7% | 28 | [8.2%, 16.4%] |
| 15.5-15.6% | 196 | 15.6% | 11.7% | 23 | [7.9%, 17.0%] |
| 15.6-15.6% | 242 | 15.6% | 14.5% | 35 | [10.6%, 19.4%] |
| 15.6-15.7% | 134 | 15.7% | 12.7% | 17 | [8.1%, 19.4%] |
| 15.7-15.7% | 166 | 15.7% | 8.4% | 14 | [5.1%, 13.7%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 15-25% | 977 | 15.6% | 12.0% | 117 | [10.1%, 14.2%] |

### rated / `prior_30d`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 14.6-15.1% | 198 | 14.8% | 11.1% | 22 | [7.5%, 16.2%] |
| 15.1-16.0% | 257 | 15.5% | 12.1% | 31 | [8.6%, 16.6%] |
| 16.0-16.1% | 141 | 16.0% | 13.5% | 19 | [8.8%, 20.1%] |
| 16.1-16.1% | 211 | 16.1% | 9.5% | 20 | [6.2%, 14.2%] |
| 16.1-16.2% | 170 | 16.2% | 14.7% | 25 | [10.2%, 20.8%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 10-15% | 152 | 14.7% | 7.9% | 12 | [4.6%, 13.3%] |
| 15-25% | 825 | 15.9% | 12.7% | 105 | [10.6%, 15.2%] |

### rated / `eval_only`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 11.6-15.1% | 210 | 14.3% | 10.0% | 21 | [6.6%, 14.8%] |
| 15.1-15.8% | 181 | 15.5% | 13.3% | 24 | [9.1%, 19.0%] |
| 15.8-16.4% | 195 | 16.1% | 10.3% | 20 | [6.7%, 15.3%] |
| 16.4-16.9% | 195 | 16.7% | 9.2% | 18 | [5.9%, 14.1%] |
| 16.9-21.8% | 196 | 17.3% | 17.3% | 34 | [12.7%, 23.3%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 10-15% | 146 | 14.0% | 9.6% | 14 | [5.8%, 15.5%] |
| 15-25% | 831 | 16.3% | 12.4% | 103 | [10.3%, 14.8%] |

### rated / `stable4`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 7.1-13.3% | 196 | 11.6% | 7.1% | 14 | [4.3%, 11.6%] |
| 13.3-15.5% | 195 | 14.4% | 10.3% | 20 | [6.7%, 15.3%] |
| 15.5-17.3% | 195 | 16.4% | 14.9% | 29 | [10.6%, 20.5%] |
| 17.3-19.2% | 195 | 18.2% | 9.7% | 19 | [6.3%, 14.7%] |
| 19.2-27.7% | 196 | 20.7% | 17.9% | 35 | [13.1%, 23.8%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% | 31 | 9.0% | 0.0% | 0 | [0.0%, 11.0%] |
| 10-15% | 308 | 13.0% | 9.1% | 28 | [6.4%, 12.8%] |
| 15-25% | 636 | 18.1% | 14.0% | 89 | [11.5%, 16.9%] |
| 25%+ † | 2 | 26.5% | 0.0% | 0 | [0.0%, 65.8%] |

### rated / `stable4_no_earlier`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 7.2-13.7% | 196 | 11.9% | 8.7% | 17 | [5.5%, 13.5%] |
| 13.7-15.6% | 195 | 14.6% | 8.2% | 16 | [5.1%, 12.9%] |
| 15.6-17.5% | 195 | 16.6% | 15.9% | 31 | [11.4%, 21.7%] |
| 17.5-19.1% | 195 | 18.3% | 11.8% | 23 | [8.0%, 17.1%] |
| 19.1-27.7% | 196 | 20.3% | 15.3% | 30 | [10.9%, 21.0%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% † | 25 | 8.9% | 0.0% | 0 | [0.0%, 13.3%] |
| 10-15% | 304 | 13.2% | 8.9% | 27 | [6.2%, 12.6%] |
| 15-25% | 645 | 18.1% | 14.0% | 90 | [11.5%, 16.8%] |
| 25%+ † | 3 | 26.2% | 0.0% | 0 | [0.0%, 56.1%] |

### rated / `gbm_canary`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5.3-11.7% | 196 | 9.6% | 12.2% | 24 | [8.4%, 17.6%] |
| 11.7-14.8% | 195 | 13.4% | 9.2% | 18 | [5.9%, 14.1%] |
| 14.8-18.0% | 195 | 16.5% | 12.8% | 25 | [8.8%, 18.2%] |
| 18.0-22.7% | 195 | 20.1% | 13.3% | 26 | [9.3%, 18.8%] |
| 22.7-50.0% | 196 | 29.0% | 12.2% | 24 | [8.4%, 17.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% | 98 | 8.3% | 11.2% | 11 | [6.4%, 19.0%] |
| 10-15% | 303 | 12.6% | 10.6% | 32 | [7.6%, 14.5%] |
| 15-25% | 438 | 19.1% | 12.1% | 53 | [9.4%, 15.5%] |
| 25%+ | 138 | 31.2% | 15.2% | 21 | [10.2%, 22.1%] |

### rated / `eval_only_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 11.5-12.5% | 196 | 12.1% | 13.3% | 26 | [9.2%, 18.7%] |
| 12.5-13.4% | 195 | 12.9% | 14.9% | 29 | [10.6%, 20.5%] |
| 13.4-14.4% | 228 | 13.9% | 12.7% | 29 | [9.0%, 17.7%] |
| 14.4-16.3% | 162 | 15.4% | 8.6% | 14 | [5.2%, 14.0%] |
| 16.3-21.8% | 196 | 17.5% | 9.7% | 19 | [6.3%, 14.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 10-15% | 665 | 13.1% | 13.1% | 87 | [10.7%, 15.9%] |
| 15-25% | 312 | 16.8% | 9.6% | 30 | [6.8%, 13.4%] |

### rated / `stable4_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 7.1-13.6% | 196 | 13.1% | 9.2% | 18 | [5.9%, 14.0%] |
| 13.6-14.4% | 195 | 14.0% | 15.9% | 31 | [11.4%, 21.7%] |
| 14.4-15.3% | 195 | 14.8% | 12.8% | 25 | [8.8%, 18.2%] |
| 15.3-16.2% | 195 | 15.7% | 12.3% | 24 | [8.4%, 17.7%] |
| 16.2-27.7% | 196 | 18.2% | 9.7% | 19 | [6.3%, 14.6%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% † | 7 | 8.6% | 0.0% | 0 | [0.0%, 35.4%] |
| 10-15% | 517 | 13.9% | 13.0% | 67 | [10.3%, 16.1%] |
| 15-25% | 451 | 16.7% | 11.1% | 50 | [8.5%, 14.3%] |
| 25%+ † | 2 | 26.5% | 0.0% | 0 | [0.0%, 65.8%] |

### rated / `stable4_no_earlier_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 7.2-13.6% | 196 | 13.1% | 10.2% | 20 | [6.7%, 15.2%] |
| 13.6-14.3% | 195 | 13.9% | 13.3% | 26 | [9.3%, 18.8%] |
| 14.3-15.0% | 195 | 14.7% | 14.4% | 28 | [10.1%, 20.0%] |
| 15.0-16.2% | 195 | 15.6% | 13.8% | 27 | [9.7%, 19.4%] |
| 16.2-27.7% | 196 | 18.2% | 8.2% | 16 | [5.1%, 12.8%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% † | 9 | 8.5% | 0.0% | 0 | [0.0%, 29.9%] |
| 10-15% | 570 | 14.0% | 12.8% | 73 | [10.3%, 15.8%] |
| 15-25% | 395 | 16.8% | 11.1% | 44 | [8.4%, 14.6%] |
| 25%+ † | 3 | 26.2% | 0.0% | 0 | [0.0%, 56.1%] |

### rated / `gbm_canary_platt`

| quantile bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5.3-13.6% | 196 | 12.5% | 11.2% | 22 | [7.5%, 16.4%] |
| 13.6-14.4% | 195 | 14.0% | 13.3% | 26 | [9.3%, 18.8%] |
| 14.4-15.7% | 195 | 15.1% | 11.3% | 22 | [7.6%, 16.5%] |
| 15.7-15.8% | 195 | 15.8% | 12.3% | 24 | [8.4%, 17.7%] |
| 15.8-40.3% | 196 | 19.8% | 11.7% | 23 | [7.9%, 17.0%] |

| fixed bin | n | mean predicted | observed | positives | Wilson 95% |
|---|---|---|---|---|---|
| 5-10% † | 23 | 8.0% | 17.4% | 4 | [7.0%, 37.1%] |
| 10-15% | 461 | 13.8% | 11.3% | 52 | [8.7%, 14.5%] |
| 15-25% | 457 | 16.3% | 12.3% | 56 | [9.6%, 15.6%] |
| 25%+ | 36 | 30.2% | 13.9% | 5 | [6.1%, 28.7%] |

## Method, settings, leakage notes

The numbered lines at the top of this file are hand-written from the tables below; the top table and everything under the AUTO marker are regenerated by `uv run forecast.py` then `uv run metrics.py`. All settings were fixed before any result was computed, and only one setting per model was run: `forecast.py` completed once (an earlier attempt crashed on a timezone bug before writing anything). The Platt rows were part of that single run. The hindsight table was added after the results were seen; it is a diagnostic, not a forecaster, and changes no forecast.

- **Walk-forward.** One refit per UTC calendar day D of submit time. Models train on window notes (2026-08-07 onward) with submitted_at < D - 7d, labels as they stand at pull time. Every note submitted during day D is predicted by that fit, so a note late in the day gives up to 24 h of labels it could legally have used. Imputation medians and scaling statistics come from the training rows only.
- **`prior_all`.** H (or NH, or rated) rate over every note in the `notes` table (back to 2025, 8,808 rows) with submitted_at < D - 7d. **`prior_30d`.** Same, over notes with D - 37d <= submitted_at < D - 7d (the latest 30 days whose labels are available), shrunk as (k + 50 * prior_all) / (n + 50). n was 1,573 to 1,949, so the shrinkage moves it by under 0.1pp. The priors use the full note history because a live forecaster would have it; models cannot, because features were pulled only for the window.
- **`eval_only`.** Logistic, C=1.0: evaluation score (standardised) + missing flag. **`stable4`.** Logistic, C=1.0: any earlier note on the tweet (0/1), tweet age in hours at first sight (clipped 0-48, standardised) + feed-missing flag, author history as two dummies (history with no H; history with an H; baseline no history), evaluation score + missing flag. **`stable4_no_earlier`.** Same without the earlier-note flag.
- **`gbm_canary`.** sklearn GradientBoostingClassifier, 100 trees, depth 2, learning rate 0.05, subsample 0.8, min leaf 20, seed 0. stable4 features plus earlier-note count (capped at 5), feed tier (small/large/xl as 0/1/2), log10 velocity at first sight, log10 author followers, has_video, has_photo, media_count, is_quote. Expected to overfit; it is a canary, not a candidate.
- **`_platt` rows.** Logistic regression (C=1e4) of the outcome on logit(raw walk-forward prediction), refit each day on predictions for notes submitted before D - 7d. Needs 300 past predictions and 15 positives, else falls back to the raw model. A model with fewer than 5 training positives outputs prior_30d (this only happened in burn-in days).
- **Missing data.** Evaluation score missing: median-imputed + flag. The flag has 1 training example before Sep 16, so its coefficient is about zero and outage notes (Sep 9-11) are effectively forecast at the median score. feed_tweets join missing: median-imputed + flag. No note is dropped.

Leakage checks and residual risks:

1. **Labels are today's status, not status at day 7.** Training labels, prior counts and the author-history feature all use cn_status at pull time. The screen measured 99.5% of statuses as final by day 7, so this is small, but a note that flipped after day 7 is seen with its later status. Cannot be fixed without status history.
2. **Earlier-note flag.** Built from competing_notes.created_at_millis < our submitted_at, so it is knowable in principle, but it comes from X's public dump, which lags about 48 h. `stable4_no_earlier` is the version that does not depend on it. The competitor's *status* is never used (that was the leaky cut in the screen).
3. **Evaluation score.** pipeline_scores.created_at is before submitted_at for all 1,937 runs that have a score (checked: minimum gap 1.1 s).
4. **Author history.** Counts only our notes on the same author_id submitted more than 7 days before this note. Evaluated per note, not per refit day.
5. **Feed features.** first_seen_* columns and raw_tweet are written once at first sight. `author_followers` can be refreshed by later capture runs; it only enters the canary.
6. **Calibration bins** are cut on the scored predictions themselves; they describe, they are not used for fitting.
7. **Leak test (run once, not part of the scripts).** Every label for notes submitted on or after 2026-08-30 00:00 UTC was replaced with a random H/NH and the walk-forward was rerun: all 33,180 predictions for refit days up to 2026-09-05 were identical to the last digit, and predictions for later days moved. `prior_all` and `prior_30d` for that day were also recomputed independently from notes.parquet and matched.
8. **Intervals.** 27 forecaster-target rows times 3 intervals each = 81 intervals; a few will exclude zero by chance.
9. **Bootstrap intervals** treat notes as independent. Notes share a daily fit, a news cycle and sometimes an author, so the note-level interval is somewhat too narrow; the day-block interval is shown alongside.

