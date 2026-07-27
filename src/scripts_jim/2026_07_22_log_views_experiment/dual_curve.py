"""Pfeffer et al. dual-curve test: log vs sigmoid growth, best-of-both.

Sigmoid s(t) = 1/(1+b*exp(-a*t)) - 1/(1+b), amplitude pinned at the snapshot:
pred = V1 * s(t2)/s(t1); shape (a, b) fit globally on train folds (RMSE log10).
Log model as before with global c. 5-fold CV, all feeds pooled, gap>=1.5x,
snapshot age <=48h (same frame as estimate_c_velocity.py).

Selection variants:
  oracle    — per tweet, whichever of log/sigmoid lands closer to the TRUTH
              (leaky; the ceiling of the dual-curve idea)
  selector  — per tweet, model chosen by snapshot-age bin, learned on train
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import pandas as pd
from analyze import GROUPS, MIN_GAP_RATIO, MAX_SNAPSHOT_AGE_H, load_group

CS = np.geomspace(0.01, 24, 60)
A_GRID = np.geomspace(0.02, 10, 25)     # sigmoid rate, 1/h
B_GRID = np.geomspace(0.5, 2000, 25)    # sigmoid offset
T1_BINS = [0, 2, 6, 12, 24, 48]
K = 5

d = pd.concat([load_group(g) for g in GROUPS], ignore_index=True)
d = d[(d.gap_ratio >= MIN_GAP_RATIO) & (d.t1_h <= MAX_SNAPSHOT_AGE_H)].copy()
d["t1bin"] = pd.cut(d.t1_h, T1_BINS)
rng = np.random.default_rng(7)
d["fold"] = rng.integers(0, K, len(d))

def err_log_model(rows, c):
    return np.log10((rows.V1 * np.log1p(rows.t2_h / c) / np.log1p(rows.t1_h / c)) / rows.V2)

def sig(t, a, b):
    return 1.0 / (1.0 + b * np.exp(-a * t)) - 1.0 / (1.0 + b)

def err_sig_model(rows, a, b):
    return np.log10((rows.V1 * sig(rows.t2_h, a, b) / sig(rows.t1_h, a, b)) / rows.V2)

def fit_log(rows):
    return CS[int(np.argmin([np.sqrt((err_log_model(rows, c) ** 2).mean()) for c in CS]))]

def fit_sig(rows):
    best, arg = np.inf, (None, None)
    for a in A_GRID:
        for b in B_GRID:
            r = np.sqrt((err_sig_model(rows, a, b) ** 2).mean())
            if r < best:
                best, arg = r, (a, b)
    return arg

oof = {m: np.zeros(len(d)) for m in ["log", "sigmoid", "oracle", "selector"]}
fitted = []
for k in range(K):
    train, test = d[d.fold != k], d.fold == k
    c = fit_log(train)
    a, b = fit_sig(train)
    fitted.append((c, a, b))
    el, es = err_log_model(d[test], c), err_sig_model(d[test], a, b)
    oof["log"][test] = el
    oof["sigmoid"][test] = es
    oof["oracle"][test] = np.where(el.abs() <= es.abs(), el, es)
    # selector: per t1 bin, whichever model has lower train RMSE
    for tb, g in train.groupby("t1bin", observed=True):
        use_log = np.sqrt((err_log_model(g, c) ** 2).mean()) <= np.sqrt((err_sig_model(g, a, b) ** 2).mean())
        m = test & (d.t1bin == tb)
        oof["selector"][m.values] = err_log_model(d[m], c) if use_log else err_sig_model(d[m], a, b)

cs, as_, bs = zip(*fitted)
print(f"fitted per fold: c={np.median(cs):.2f}h  sigmoid a={np.median(as_):.3f}/h  b={np.median(bs):.0f} "
      f"(half-rise at ln(b)/a = {np.log(np.median(bs))/np.median(as_):.1f}h)")
print(f"\n=== 5-fold CV, held-out (n={len(d)}) ===")
for m, e in oof.items():
    e = pd.Series(e)
    print(f"  {m:>9}: RMSE={np.sqrt((e**2).mean()):.3f}  median |err|=×{10**e.abs().median():.3f}  within-2x={100*(e.abs()<=np.log10(2)).mean():.1f}%")
share = (pd.Series(oof['log']).abs() <= pd.Series(oof['sigmoid']).abs()).mean()
print(f"\noracle picks log for {share:.0%} of tweets")

print("\n=== oracle shape split by feed ===")
pick_log = pd.Series(oof["log"]).abs() <= pd.Series(oof["sigmoid"]).abs()
for g, grp in d.assign(pick_log=pick_log.values).groupby("group"):
    n = len(grp)
    print(f"  {g:>11}: n={n:4d}  log-shaped {grp.pick_log.sum():4d} ({grp.pick_log.mean():.0%})  "
          f"sigmoid-shaped {(~grp.pick_log).sum():4d} ({(~grp.pick_log).mean():.0%})")

print("\n=== does velocity predict log- vs sigmoid-shaped? ===")
dd = d.assign(pick_log=pick_log.values)
dd["vbin2"] = pd.cut(dd.velocity, [0, 500, 2_000, 8_000, 30_000, 125_000, np.inf], right=False)
for b, g in dd.groupby("vbin2", observed=True):
    print(f"  v in {str(b):>20}: n={len(g):4d}  log-shaped {g.pick_log.mean():.0%}")
# AUC of velocity as a classifier of log-shape (pooled, then within each feed)
def auc(x, y):
    r = pd.Series(x).rank()
    n1, n0 = y.sum(), (~y).sum()
    return (r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)
print(f"  AUC(velocity -> log-shaped), pooled: {auc(dd.velocity, dd.pick_log):.3f}")
for g, grp in dd.groupby("group"):
    print(f"  AUC within {g:>11}: {auc(grp.velocity, grp.pick_log):.3f}")

print("\n=== best c fitted on the log-shaped population only ===")
CS_FINE = np.geomspace(0.01, 24, 120)
def fit_log_fine(rows):
    rmses = [np.sqrt((err_log_model(rows, c) ** 2).mean()) for c in CS_FINE]
    i = int(np.argmin(rmses))
    return CS_FINE[i], rmses[i]
logpop = dd[dd.pick_log]
for name, rows in [("small_feed", logpop[logpop.group == "small_feed"]),
                   ("large_feed", logpop[logpop.group == "large_feed"]),
                   ("xxl_dump", logpop[logpop.group == "xxl_dump"]),
                   ("all_feeds", logpop)]:
    c, r = fit_log_fine(rows)
    e = err_log_model(rows, c)
    print(f"  {name:>11}: n={len(rows):4d}  best c={c:5.2f}h  RMSE={r:.3f}  median |err|=×{10**e.abs().median():.3f}")
