# Log-growth prediction experiment

Model: V(t) = a·ln(1+t_hours), pinned through (0,0) and the DB snapshot (t1, V1); predict current views V2 at age t2. Baselines pinned identically. Headline tables restrict to tweets with t2/t1 ≥ 1.5 — below that every model trivially says 'unchanged'.

## small_feed

**gap ≥ 1.5×** (n=903)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.64× | 71% | 22% | over-predicts ×1.36 |
| frozen | 2.42× | 42% | 13% | under-predicts ×2.42 |
| sqrt | 4.25× | 16% | 5% | over-predicts ×4.19 |
| linear | 42.58× | 1% | 0% | over-predicts ×42.58 |

**all usable rows** (n=904)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.64× | 71% | 22% | over-predicts ×1.36 |
| frozen | 2.42× | 42% | 13% | under-predicts ×2.42 |
| sqrt | 4.25× | 16% | 5% | over-predicts ×4.18 |
| linear | 42.50× | 1% | 0% | over-predicts ×42.50 |

## large_feed

**gap ≥ 1.5×** (n=913)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.79× | 59% | 19% | over-predicts ×1.28 |
| frozen | 3.64× | 21% | 4% | under-predicts ×3.64 |
| sqrt | 3.89× | 22% | 5% | over-predicts ×3.74 |
| linear | 50.09× | 1% | 0% | over-predicts ×50.09 |

**all usable rows** (n=915)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.78× | 59% | 19% | over-predicts ×1.28 |
| frozen | 3.60× | 21% | 4% | under-predicts ×3.60 |
| sqrt | 3.88× | 22% | 6% | over-predicts ×3.72 |
| linear | 49.77× | 1% | 1% | over-predicts ×49.77 |

## xxl_dump

**gap ≥ 1.5×** (n=785)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.30× | 95% | 36% | over-predicts ×1.28 |
| frozen | 1.11× | 91% | 71% | under-predicts ×1.11 |
| sqrt | 1.84× | 66% | 4% | over-predicts ×1.83 |
| linear | 3.90× | 3% | 1% | over-predicts ×3.89 |

**all usable rows** (n=791)

| model | median error (×) | within 2× | within 1.26× | bias |
|---|---|---|---|---|
| log | 1.30× | 95% | 36% | over-predicts ×1.28 |
| frozen | 1.11× | 91% | 71% | under-predicts ×1.11 |
| sqrt | 1.84× | 67% | 5% | over-predicts ×1.83 |
| linear | 3.88× | 4% | 1% | over-predicts ×3.88 |

## Time-constant sweep

V = a·ln(1+t/c) is NOT pinned by (0,0) + one point — the origin holds for every (a, c). The main tables fix c = 1h by convention; this sweep uses each tweet's second point to find the best global c.

| c (hours) | small_feed | large_feed | xxl_dump |
|---|---|---|---|
| 0.1 | ×1.46, 74% in 2× | ×1.62, 63% in 2× | ×1.18, 95% in 2× |
| 0.3 | ×1.51, 79% in 2× | ×1.62, 66% in 2× | ×1.22, 95% in 2× |
| 1 | ×1.64, 71% in 2× | ×1.79, 59% in 2× | ×1.30, 95% in 2× |
| 3 | ×2.02, 49% in 2× | ×2.35, 41% in 2× | ×1.44, 91% in 2× |
| 10 | ×3.14, 22% in 2× | ×3.81, 21% in 2× | ×1.72, 70% in 2× |
| 24 | ×4.84, 10% in 2× | ×6.30, 11% in 2× | ×2.09, 45% in 2× |
| 72 | ×8.98, 3% in 2× | ×12.23, 5% in 2× | ×2.72, 12% in 2× |
| 240 | ×17.16, 1% in 2× | ×22.82, 2% in 2× | ×3.34, 5% in 2× |

## Velocity follow-up

Velocity = V1/t1 (impressions/hour at snapshot), only tweets whose snapshot was taken at age ≤ 48h and gap ≥ 1.5×.

- **small_feed**: velocity ≥ 0/h → 71% of predictions within 2×
- **large_feed**: no velocity threshold reaches 70% within-2×
- **xxl_dump**: velocity ≥ 0/h → 95% of predictions within 2×

Plots: `plots/pred_vs_actual.png`, `plots/error_distributions.png`, `plots/velocity_vs_accuracy.png`

## Between-feed decomposition (velocity vs extrapolation distance)

| feed | within-2x | median velocity | median t2/t1 |
|---|---|---|---|
| small_feed | 70.5% | 26,897/h | 115.5x |
| large_feed | 59.2% | 16,215/h | 227.7x |
| xxl_dump | 94.7% | 192/h | 4.9x |

Velocity ordering is the OPPOSITE of accuracy ordering (xxl: lowest velocity, highest accuracy) — velocity composition predicts the wrong sign for every xxl comparison. The dominant driver is extrapolation distance t2/t1; matched on it (15-30x bin) xxl is the WORST feed (64% vs small 92% / large 95%), and the small-vs-large residual shrinks to ~+4..+11pp. Full tables: run `velocity_decomposition.py`.
