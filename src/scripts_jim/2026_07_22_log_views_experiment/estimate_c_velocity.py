"""Estimate c as a function of snapshot velocity (all feeds pooled) and test
whether velocity-dependent c beats one global c, using 5-fold cross-validation
(c is always fit on train folds, error measured on held-out tweets).

Velocity = V1/t1; restricted to snapshots taken at age <=48h so velocity means
"early velocity". Criterion for fitting c: RMSE of log10 error (the median
criterion is degenerate — c->0 collapses the model into the frozen baseline).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import pandas as pd
from analyze import GROUPS, MIN_GAP_RATIO, MAX_SNAPSHOT_AGE_H, load_group

CS = np.geomspace(0.01, 24, 80)
VEL_EDGES = [0, 500, 2_000, 8_000, 30_000, 125_000, np.inf]
K = 5

d = pd.concat([load_group(g) for g in GROUPS], ignore_index=True)
d = d[(d.gap_ratio >= MIN_GAP_RATIO) & (d.t1_h <= MAX_SNAPSHOT_AGE_H)].copy()
d["vbin"] = pd.cut(d.velocity, VEL_EDGES, right=False)
rng = np.random.default_rng(7)
d["fold"] = rng.integers(0, K, len(d))

def log_err(rows, c):
    return np.log10((rows.V1 * np.log1p(rows.t2_h / c) / np.log1p(rows.t1_h / c)) / rows.V2)

def best_c(rows):
    rmses = [np.sqrt((log_err(rows, c) ** 2).mean()) for c in CS]
    return CS[int(np.argmin(rmses))]

print("=== c fitted per velocity bin (full data) ===")
for b, g in d.groupby("vbin", observed=True):
    print(f"  v in {str(b):>20}: n={len(g):4d}  best c = {best_c(g):6.2f}h  median v={g.velocity.median():>9,.0f}/h")

# log-log fit: log10(c) = a + b*log10(velocity)
cs_by_bin = d.groupby("vbin", observed=True).apply(best_c, include_groups=False)
med_v = d.groupby("vbin", observed=True).velocity.median()
coef = np.polyfit(np.log10(med_v), np.log10(cs_by_bin.astype(float)), 1)
print(f"\npower-law fit: c(v) = {10**coef[1]:.3f}h * (v)^{coef[0]:.3f}")

print(f"\n=== 5-fold CV: held-out error ===")
oof = {}
for name in ["global_c", "c_per_velocity", "frozen"]:
    oof[name] = np.zeros(len(d))
for k in range(K):
    train, test_idx = d[d.fold != k], d.fold == k
    cg = best_c(train)
    oof["global_c"][test_idx] = log_err(d[test_idx], cg)
    oof["frozen"][test_idx] = np.log10(d[test_idx].V1 / d[test_idx].V2)
    for b, g in train.groupby("vbin", observed=True):
        cb = best_c(g)
        m = test_idx & (d.vbin == b)
        oof["c_per_velocity"][m.values] = log_err(d[m], cb)
for name, e in oof.items():
    e = pd.Series(e)
    print(f"  {name:>15}: RMSE={np.sqrt((e**2).mean()):.3f}  median |err|=×{10**e.abs().median():.3f}  within-2x={100*(e.abs()<=np.log10(2)).mean():.1f}%")
