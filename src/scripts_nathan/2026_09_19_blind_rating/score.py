# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
"""Scores every rater against the outcomes, and against each other.

Run it with no arguments once both raters have finished. It reads whichever
ratings files exist, so a partial run is fine and only scores the notes that
rater actually answered.

The benchmark is the base rate of this set, not the live 11%, because the
sample was stratified and both raters were told so. Beating a constant is the
bar: a forecaster who cannot is adding nothing over knowing the mix.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).parent
DATA = HERE / "data"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
CLIP = (0.001, 0.999)


def brier(p, y):
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def logloss(p, y):
    p = np.clip(np.asarray(p, dtype=float), *CLIP)
    y = np.asarray(y)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def wilson(k, n):
    if n == 0:
        return (0.0, 0.0)
    z, phat = 1.96, k / n
    d = 1 + z * z / n
    centre = (phat + z * z / (2 * n)) / d
    half = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def bootstrap_diff(pa, pb, y, draws=2000, seed=0):
    """95% interval on the Brier difference, a minus b. Negative favours a."""
    d = (np.asarray(pa) - y) ** 2 - (np.asarray(pb) - y) ** 2
    rng = np.random.default_rng(seed)
    n = len(d)
    boots = np.array([d[rng.integers(0, n, n)].mean() for _ in range(draws)])
    return float(d.mean()), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


def calibration(p, y, edges=(0, 0.15, 0.3, 0.45, 0.6, 1.01)):
    rows = []
    p, y = np.asarray(p), np.asarray(y)
    for lo, hi in zip(edges, edges[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum() == 0:
            continue
        k, n = int(y[m].sum()), int(m.sum())
        lo_ci, hi_ci = wilson(k, n)
        rows.append((f"{lo:.0%}-{hi:.0%}", n, float(p[m].mean()), k / n, lo_ci, hi_ci))
    return rows


def main() -> None:
    sample = json.loads((DATA / "sample.json").read_text())
    truth = {r["note_id"]: 1 if r["outcome"] == HELPFUL else 0 for r in sample}
    evals = {r["note_id"]: r["context"]["eval_score"] for r in sample}
    base = sum(truth.values()) / len(truth)
    print(f"sample: {len(truth)} notes, {sum(truth.values())} rated helpful ({base:.1%})\n")

    # A rater still working is skipped, so running this to check the script
    # cannot leak a partial answer to whoever is watching the output. Pass
    # --partial deliberately to override.
    partial_ok = "--partial" in sys.argv
    raters = {}
    for path in sorted(DATA.glob("ratings_*.json")):
        name = path.stem.replace("ratings_", "")
        rows = json.loads(path.read_text())
        ids = [n for n in rows if n in truth]
        if not ids:
            continue
        if len(ids) < len(truth) and not partial_ok:
            print(f"skipping {name}: {len(ids)} of {len(truth)} done (pass --partial to score anyway)")
            continue
        raters[name] = {
            "ids": ids,
            "p": np.array([rows[n]["p_helpful"] / 100 for n in ids]),
            "y": np.array([truth[n] for n in ids]),
            "secs": [rows[n].get("seconds", 0) for n in ids],
        }

    if not raters:
        print("no ratings yet")
        return

    print(f"{'rater':10s} {'n':>4s} {'brier':>8s} {'vs base':>9s} {'logloss':>8s} {'auc':>6s} {'mean p':>7s} {'observed':>9s} {'median s':>9s}")
    for name, r in raters.items():
        const = np.full(len(r["ids"]), r["y"].mean())
        diff, lo, hi = bootstrap_diff(r["p"], const, r["y"])
        auc = roc_auc_score(r["y"], r["p"]) if 0 < r["y"].sum() < len(r["y"]) else float("nan")
        med = int(np.median(r["secs"])) if r["secs"] else 0
        print(f"{name:10s} {len(r['ids']):4d} {brier(r['p'], r['y']):8.4f} {diff:+9.4f} "
              f"{logloss(r['p'], r['y']):8.4f} {auc:6.3f} {r['p'].mean():7.1%} {r['y'].mean():9.1%} {med:9d}")
        print(f"{'':10s}      95% interval on the Brier difference [{lo:+.4f}, {hi:+.4f}]"
              f"  {'beats the base rate' if hi < 0 else ('worse than the base rate' if lo > 0 else 'not distinguishable')}")

    # X's own evaluation score, on the notes that have one, as a third opinion.
    ids = [n for n in truth if evals.get(n) is not None]
    if len(ids) > 20:
        ev = np.array([evals[n] for n in ids])
        y = np.array([truth[n] for n in ids])
        if 0 < y.sum() < len(y):
            print(f"\nX's evaluation score, where present: n={len(ids)} auc={roc_auc_score(y, ev):.3f}")

    for name, r in raters.items():
        print(f"\ncalibration, {name}")
        for band, n, meanp, obs, lo, hi in calibration(r["p"], r["y"]):
            print(f"  said {band:9s} n={n:4d}  predicted {meanp:5.1%}  actual {obs:5.1%}  [{lo:.1%}, {hi:.1%}]")

    names = list(raters)
    if len(names) == 2:
        a, b = raters[names[0]], raters[names[1]]
        shared = [n for n in a["ids"] if n in set(b["ids"])]
        if len(shared) > 10:
            pa = np.array([a["p"][a["ids"].index(n)] for n in shared])
            pb = np.array([b["p"][b["ids"].index(n)] for n in shared])
            y = np.array([truth[n] for n in shared])
            print(f"\nagreement on {len(shared)} shared notes: correlation {np.corrcoef(pa, pb)[0,1]:.2f}, "
                  f"mean gap {np.abs(pa - pb).mean():.1%}")
            diff, lo, hi = bootstrap_diff(pa, pb, y)
            print(f"  {names[0]} minus {names[1]} on Brier: {diff:+.4f} [{lo:+.4f}, {hi:+.4f}]")
            avg = (pa + pb) / 2
            d2, l2, h2 = bootstrap_diff(avg, np.full(len(y), y.mean()), y)
            print(f"  the two averaged: brier {brier(avg, y):.4f}, vs base {d2:+.4f} [{l2:+.4f}, {h2:+.4f}], auc {roc_auc_score(y, avg):.3f}")
            order = np.argsort(-np.abs(pa - pb))[:10]
            print(f"\n  biggest disagreements ({names[0]} / {names[1]} / outcome):")
            for i in order:
                note = next(s for s in sample if s["note_id"] == shared[i])
                print(f"    {pa[i]:.0%} / {pb[i]:.0%} / {'HELPFUL' if y[i] else 'not'}  {note['note_text'][:90]}")


if __name__ == "__main__":
    main()
