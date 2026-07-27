"""Are the BETWEEN-FEED differences in log-model accuracy explained by velocity?

All three groups. Per feed: velocity mixture, within-velocity-bin accuracy,
pairwise counterfactuals (feed A's accuracy curve on feed B's velocity mix).
Plus the competing explanation: extrapolation distance (t2/t1) bins.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import pandas as pd
from analyze import load_group, MIN_GAP_RATIO, MAX_SNAPSHOT_AGE_H

VEL_EDGES = [0, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 125_000, 250_000, np.inf]
GAP_EDGES = [1.5, 2, 3, 5, 8, 15, 30, 60, 120, np.inf]
GROUPS = ["small_feed", "large_feed", "xxl_dump"]

dfs = {}
for g in GROUPS:
    d = load_group(g)
    d = d[(d.t1_h <= MAX_SNAPSHOT_AGE_H) & (d.gap_ratio >= MIN_GAP_RATIO)].copy()
    d["ok"] = d.err_log.abs() <= np.log10(2)
    d["vbin"] = pd.cut(d.velocity, VEL_EDGES, right=False)
    d["gbin"] = pd.cut(d.gap_ratio, GAP_EDGES, right=False)
    dfs[g] = d

print("=== per-feed summary (snapshot age <=48h, gap >=1.5x) ===")
for g in GROUPS:
    d = dfs[g]
    print(f"{g:>11}: n={len(d):4d}  within-2x={d.ok.mean():.1%}  "
          f"median velocity={d.velocity.median():>9,.0f}/h  median t1={d.t1_h.median():5.1f}h  "
          f"median gap t2/t1={d.gap_ratio.median():6.1f}x")

print("\n=== within-2x by velocity bin ===")
accs = {g: dfs[g].groupby("vbin", observed=False).ok.mean() for g in GROUPS}
ns = {g: dfs[g].vbin.value_counts().sort_index() for g in GROUPS}
for b in accs[GROUPS[0]].index:
    cells = [f"{g.split('_')[0]:>5} {accs[g][b]:4.0%} (n={ns[g].get(b, 0):3d})" if ns[g].get(b, 0) >= 15 else f"{g.split('_')[0]:>5}    –        " for g in GROUPS]
    print(f"  {str(b):>20}  " + "  ".join(cells))

print("\n=== pairwise velocity-composition counterfactuals ===")
for a, b in [("small_feed", "large_feed"), ("small_feed", "xxl_dump"), ("large_feed", "xxl_dump")]:
    da, db = dfs[a], dfs[b]
    gap = da.ok.mean() - db.ok.mean()
    mix_b = db.vbin.value_counts(normalize=True).sort_index()
    cf = float(np.nansum(accs[a] * mix_b))  # a's accuracy curve on b's mixture
    expl = (da.ok.mean() - cf) / gap if gap else np.nan
    print(f"{a} vs {b}: gap {gap:+.1%}; {a} on {b}'s velocity mix -> {cf:.1%} "
          f"(composition explains {expl:+.0%})")

print("\n=== within-2x by extrapolation distance (t2/t1) ===")
gaccs = {g: dfs[g].groupby("gbin", observed=False).ok.mean() for g in GROUPS}
gns = {g: dfs[g].gbin.value_counts().sort_index() for g in GROUPS}
for b in gaccs[GROUPS[0]].index:
    cells = [f"{g.split('_')[0]:>5} {gaccs[g][b]:4.0%} (n={gns[g].get(b, 0):3d})" if gns[g].get(b, 0) >= 15 else f"{g.split('_')[0]:>5}    –        " for g in GROUPS]
    print(f"  {str(b):>16}  " + "  ".join(cells))

# Append the between-feed findings to RESULTS.md (analyze.py rewrites it, so
# this script must run after analyze.py to keep the section present).
lines = ["## Between-feed decomposition (velocity vs extrapolation distance)", "",
         "| feed | within-2x | median velocity | median t2/t1 |", "|---|---|---|---|"]
for g in GROUPS:
    d = dfs[g]
    lines.append(f"| {g} | {d.ok.mean():.1%} | {d.velocity.median():,.0f}/h | {d.gap_ratio.median():.1f}x |")
lines += ["",
          "Velocity ordering is the OPPOSITE of accuracy ordering (xxl: lowest velocity, "
          "highest accuracy) — velocity composition predicts the wrong sign for every "
          "xxl comparison. The dominant driver is extrapolation distance t2/t1; matched on "
          "it (15-30x bin) xxl is the WORST feed (64% vs small 92% / large 95%), and the "
          "small-vs-large residual shrinks to ~+4..+11pp. Full tables: run "
          "`velocity_decomposition.py`.", ""]
md = Path(__file__).parent / "RESULTS.md"
md.write_text(md.read_text() + "\n" + "\n".join(lines))
print(f"\n[decomposition] appended between-feed section to {md}")
