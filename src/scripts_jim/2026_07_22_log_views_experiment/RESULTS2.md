# Fair re-analysis (v2)

v1's within-2x horse race conflated model quality with task difficulty (xxl extrapolates ~5x past its snapshot; small/large 100-200x). All numbers below use the empirically best time constant c=0.3h.

## Skill vs the frozen baseline (log10 space, gap >= 1.5x)

skill = 1 - MSE(log model)/MSE(frozen). Positive = predicting log growth beats predicting no growth on that group's own task.

| group | n | RMSE log | RMSE frozen | skill | R2 (growth) | med \|err\|/dex |
|---|---|---|---|---|---|---|
| small_feed | 903 | 0.335 | 0.617 | +0.70 | 0.35 | 0.093 |
| large_feed | 913 | 0.438 | 0.800 | +0.70 | 0.16 | 0.094 |
| xxl_dump | 785 | 0.165 | 0.230 | +0.48 | 0.37 | 0.146 |
| POOLED | 2601 | 0.338 | 0.611 | +0.69 | 0.44 | 0.109 |

## Shape test (pooled, non-parametric)

Empirical growth elasticity b = dlog(views)/dlog(age) vs the log-law curve b_pred(t) (c=0.3h). `plots/shape_test.png`.

| age (h) | n | b empirical (median) | b log-law |
|---|---|---|---|
| 11 | 25 | 0.304 | 0.306 |
| 17 | 89 | 0.294 | 0.270 |
| 26 | 241 | 0.268 | 0.243 |
| 39 | 554 | 0.203 | 0.215 |
| 60 | 839 | 0.155 | 0.196 |
| 92 | 526 | 0.151 | 0.181 |
| 140 | 251 | 0.096 | 0.169 |
| 215 | 61 | 0.065 | 0.159 |

## View-magnitude check (pooled)

Median |log10 error| per dex of extrapolation, by views at snapshot. `plots/fairness.png`.

| V1 range | n | med \|err\|/dex |
|---|---|---|
| 10^2-10^3 | 180 | 0.124 |
| 10^3-10^4 | 335 | 0.126 |
| 10^4-10^5 | 823 | 0.109 |
| 10^5-10^6 | 845 | 0.100 |
| 10^6-10^8 | 223 | 0.092 |
