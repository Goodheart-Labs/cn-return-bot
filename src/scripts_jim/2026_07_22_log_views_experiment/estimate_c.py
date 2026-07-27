"""Best time-constant c per feed: fine grid over c, minimizing median |log10 err|
(robust) and RMSE(log10) for V(t)=a*ln(1+t/c) pinned at the snapshot."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import pandas as pd
from analyze import GROUPS, MIN_GAP_RATIO, load_group

dfs = {g: load_group(g) for g in GROUPS}
dfs = {g: d[d.gap_ratio >= MIN_GAP_RATIO] for g, d in dfs.items()}
dfs["all_feeds"] = pd.concat(dfs.values(), ignore_index=True)

CS = np.geomspace(0.01, 24, 120)  # hours

def err_curves(d):
    med, rmse = [], []
    for c in CS:
        e = np.log10((d.V1 * np.log1p(d.t2_h / c) / np.log1p(d.t1_h / c)) / d.V2)
        med.append(e.abs().median()); rmse.append(np.sqrt((e ** 2).mean()))
    return np.array(med), np.array(rmse)

print(f"{'group':>11} | best c (median |err|) | median err at best | near-optimal range (<=1% worse) | best c (RMSE)")
for g, d in dfs.items():
    med, rmse = err_curves(d)
    i = med.argmin()
    ok = CS[med <= med[i] * 1.01]
    print(f"{g:>11} | {CS[i]:>8.2f}h | ×{10**med[i]:.3f} | {ok.min():.2f}–{ok.max():.2f}h | {CS[rmse.argmin()]:.2f}h")
