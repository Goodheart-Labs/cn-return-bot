"""
Routine-gap vs. note-outcome rate, split by Small vs Large feed.

Question: does the time gap between consecutive "create notes routine" runs relate
to the outcomes of the notes that routine submits?

Per routine run:
  - x = minutes since the PREVIOUS routine started (GitHub Actions run_started_at)
  - y = an outcome rate over the notes it submitted.

Each submitted note is classified into the review-dashboard's mutually-exclusive
failure type (src/review-dashboard/src/lib/data.ts cnStatusToFailureType):
  rated_helpful      cn_status == CURRENTLY_RATED_HELPFUL
  rated_unhelpful    cn_status == CURRENTLY_RATED_NOT_HELPFUL
  lost_to_competitor cn_status not helpful/unhelpful AND a competing note on the
                     same tweet (competing_notes.our_note_id) is CURRENTLY_RATED_HELPFUL
  needs_more_ratings cn_status == NEEDS_MORE_RATINGS and no helpful competitor
  uncategorized      cn_status null and no helpful competitor

Two metrics are produced, both over the SAME base so they're comparable
(base = helpful + needs_more_ratings + lost_to_competitor; unhelpful and bare-null
 excluded, matching the original helpful-rate's "leave out unhelpful"):
  helpful = #rated_helpful      / base
  lost    = #lost_to_competitor / base

Run twice each, once per feed bucket (Small={small}, Large={large,xl,xxl}); feed is
pipeline_runs.ab_test_picks->>'feed_size' on the submitting run.

Outputs: <metric>_scatter_<feed>.png, <metric>_pooled_<feed>.png, <metric>_per_routine_<feed>.csv
Prereq: run fetch_runs.py first (writes routine_runs.json).
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000
UUID_ZERO = "00000000-0000-0000-0000-000000000000"
WINDOW_START = "2026-05-01T00:00:00Z"          # ~2 months back
NOW = datetime.now(timezone.utc)
MATURITY_CUTOFF = NOW - timedelta(days=2)        # public dump lags ~48h
HELPFUL, NOT_HELPFUL, NMR = (
    "CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL", "NEEDS_MORE_RATINGS")
LARGE_TIERS = {"large", "xl", "xxl"}
BASE_TYPES = {"rated_helpful", "needs_more_ratings", "lost_to_competitor"}

# metric -> (numerator failure type, y-label, formula-for-title)
METRICS = {
    "helpful": ("rated_helpful",
                "Helpful rate", "#helpful / (#helpful + #NMR + #lost)"),
    "lost": ("lost_to_competitor",
             "Lost-to-competitor rate", "#lost / (#helpful + #NMR + #lost)"),
}


# ----------------------------------------------------------------------------- fetch
def fetch_paginated(table, cols, key, apply_filters, start):
    rows, last = [], start
    while True:
        q = sb.table(table).select(cols).order(key).gt(key, last).limit(PAGE)
        batch = apply_filters(q).execute().data
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1][key]
        if len(batch) < PAGE:
            break
    return rows


def load_routine_starts():
    runs = json.loads((HERE / "routine_runs.json").read_text())
    starts = pd.to_datetime([r["run_started_at"] for r in runs], utc=True, format="ISO8601").sort_values()
    df = pd.DataFrame({"routine_start": starts})
    df["elapsed_min"] = df["routine_start"].diff().dt.total_seconds() / 60.0
    return df.reset_index(drop=True)


def load_lost_note_ids():
    # our_note_ids that have at least one currently-helpful competitor on the same tweet
    # (missed-opportunity rows have our_note_id NULL and are skipped).
    rows = fetch_paginated(
        "competing_notes", "id, our_note_id, current_status",
        key="id",
        apply_filters=lambda q: q.eq("current_status", HELPFUL),
        start=UUID_ZERO,
    )
    return {r["our_note_id"] for r in rows if r.get("our_note_id")}


def classify(cn_status, has_helpful_competitor):
    if cn_status == HELPFUL:
        return "rated_helpful"
    if cn_status == NOT_HELPFUL:
        return "rated_unhelpful"
    if has_helpful_competitor:
        return "lost_to_competitor"
    if cn_status == NMR:
        return "needs_more_ratings"
    return "uncategorized"


def load_notes():
    print("Fetching submitted pipeline_runs...")
    runs = fetch_paginated(
        "pipeline_runs", "id, note_id, ab_test_picks",
        key="id",
        apply_filters=lambda q: q.eq("outcome", "submitted").gte("created_at", WINDOW_START),
        start=UUID_ZERO,
    )
    runs = [r for r in runs if r.get("note_id")]
    feed = pd.DataFrame({
        "note_id": [r["note_id"] for r in runs],
        "feed_size": [(r.get("ab_test_picks") or {}).get("feed_size") for r in runs],
    }).drop_duplicates("note_id")

    print("Fetching notes...")
    notes = fetch_paginated(
        "notes", "note_id, submitted_at, cn_status",
        key="note_id",
        apply_filters=lambda q: q.gte("submitted_at", WINDOW_START),
        start="",
    )
    notes = pd.DataFrame(notes)
    notes["submitted_at"] = pd.to_datetime(notes["submitted_at"], utc=True, format="ISO8601")

    print("Fetching competing_notes (helpful competitors)...")
    lost_ids = load_lost_note_ids()
    notes["failure_type"] = [
        classify(s, nid in lost_ids)
        for s, nid in zip(notes["cn_status"], notes["note_id"])
    ]

    df = notes.merge(feed, on="note_id", how="inner")  # submitted notes with a known feed
    return df


# ----------------------------------------------------------------------------- shape
def assign_routine(notes, routines):
    starts = routines["routine_start"].values.astype("datetime64[ns]")
    sub = notes["submitted_at"].dt.tz_convert(None).values.astype("datetime64[ns]")
    idx = np.searchsorted(starts, sub, side="right") - 1   # routine whose window holds the note
    notes = notes.copy()
    notes["routine_idx"] = idx
    notes = notes[notes["routine_idx"] >= 0]               # drop notes before the first start
    notes["elapsed_min"] = routines["elapsed_min"].values[notes["routine_idx"]]
    return notes[notes["elapsed_min"].notna()]             # drop the very first routine (no gap)


def base_notes(notes):
    return notes[notes["failure_type"].isin(BASE_TYPES)].copy()


def per_routine_metric(notes, numer_type):
    n = base_notes(notes)
    n["in_numer"] = n["failure_type"] == numer_type
    g = n.groupby("routine_idx").agg(
        elapsed_min=("elapsed_min", "first"),
        numer=("in_numer", "sum"),
        denom=("in_numer", "size"),
        routine_start=("submitted_at", "min"),
    )
    g = g[g["denom"] > 0]
    g["rate"] = g["numer"] / g["denom"]
    return g.reset_index()


# ----------------------------------------------------------------------------- stats
def wilson_ci(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (center - half, center + half)


def fit_line(x, y):
    slope, intercept = np.polyfit(x, y, 1)
    pearson = np.corrcoef(x, y)[0, 1]
    spearman = pd.Series(x).corr(pd.Series(y), method="spearman")
    return slope, intercept, pearson, spearman


# ----------------------------------------------------------------------------- plots
def plot_scatter(g, feed, ylabel, path):
    x, y = g["elapsed_min"].values, g["rate"].values
    slope, intercept, pearson, spearman = fit_line(x, y)
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.scatter(x, y, s=8 * g["denom"], alpha=0.35, edgecolors="none", color="#2b6cb0")
    xlim = np.percentile(x, 99)
    xs = np.linspace(0, xlim, 100)
    ax.plot(xs, slope * xs + intercept, color="#e53e3e", lw=2,
            label=f"OLS: y={slope:.2e}·x+{intercept:.2f}")
    ax.set_xlim(0, xlim)
    ax.set_ylim(-0.03, 1.03)
    ax.set_xlabel("Minutes since previous routine started")
    ax.set_ylabel(ylabel)
    off = (x > xlim).sum()
    ax.set_title(f"{feed} feed — {ylabel} — one point per routine (size ∝ #notes in base)\n"
                 f"n={len(g)} routines, {int(g['denom'].sum())} base notes  |  "
                 f"Pearson r={pearson:.3f}, Spearman ρ={spearman:.3f}, R²={pearson**2:.3f}")
    if off:
        ax.text(0.99, 0.02, f"{off} routines >p99 gap off-scale",
                transform=ax.transAxes, ha="right", va="bottom", fontsize=8, color="#718096")
    ax.legend(loc="upper right")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return slope, intercept, pearson, spearman


def plot_pooled(notes_feed, feed, numer_type, ylabel, path, n_bins=8):
    n = base_notes(notes_feed)
    n["in_numer"] = n["failure_type"] == numer_type
    n["bin"] = pd.qcut(n["elapsed_min"], q=min(n_bins, n["elapsed_min"].nunique()), duplicates="drop")
    rows = []
    for _, sub in n.groupby("bin", observed=True):
        k, tot = int(sub["in_numer"].sum()), len(sub)
        lo, hi = wilson_ci(k, tot)
        rows.append({"center": sub["elapsed_min"].mean(), "rate": k / tot,
                     "lo": lo, "hi": hi, "n": tot})
    d = pd.DataFrame(rows)
    fig, ax = plt.subplots(figsize=(9, 6))
    ax.errorbar(d["center"], d["rate"],
                yerr=[d["rate"] - d["lo"], d["hi"] - d["rate"]],
                fmt="o-", color="#2b6cb0", ecolor="#a0aec0", capsize=3, lw=1.5)
    for _, r in d.iterrows():
        ax.annotate(f"n={r['n']}", (r["center"], r["rate"]),
                    textcoords="offset points", xytext=(0, 8), ha="center", fontsize=8)
    ax.set_ylim(0, max(0.5, d["hi"].max() * 1.1))
    ax.set_xlabel("Minutes since previous routine started (bin mean)")
    ax.set_ylabel(f"Pooled {ylabel.lower()}")
    ax.set_title(f"{feed} feed — {ylabel} — notes pooled into {len(d)} equal-count gap bins\n"
                 f"{int(d['n'].sum())} base notes  (95% Wilson CI)")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ----------------------------------------------------------------------------- main
def main():
    routines = load_routine_starts()
    notes = load_notes()

    print(f"\n=== Sanity report ===")
    print(f"Routine runs (GitHub invocations): {len(routines)}  "
          f"({routines['routine_start'].min()} → {routines['routine_start'].max()})")
    print(f"Submitted notes in window (pre-maturity-filter): {len(notes)}")

    # feed_size only became reliably recorded in June; ~all unrecorded notes are early-May.
    # Their true feed is unknown, so exclude them rather than guess (would pollute Small).
    missing_feed = notes["feed_size"].isna().sum()
    notes = notes[notes["feed_size"].notna()].copy()
    print(f"  notes with unrecorded feed_size (EXCLUDED, ~all early May): {missing_feed}")
    print(f"  per-tier feed counts (recorded only):\n{notes['feed_size'].value_counts().to_string()}")

    mature = notes[notes["submitted_at"] <= MATURITY_CUTOFF].copy()
    print(f"\nAfter dropping last 2 days (maturity): {len(mature)} notes "
          f"(cutoff {MATURITY_CUTOFF.isoformat()})")

    mature["feed_bucket"] = np.where(mature["feed_size"].isin(LARGE_TIERS), "Large", "Small")
    binned = assign_routine(mature, routines)
    print(f"Notes binned to a routine with a defined gap: {len(binned)}")

    print(f"\nFailure-type breakdown by feed bucket:")
    print(pd.crosstab(binned["feed_bucket"], binned["failure_type"], dropna=False).to_string())

    for metric, (numer_type, ylabel, formula) in METRICS.items():
        print(f"\n##### metric: {metric}  ({ylabel} = {formula}) #####")
        for feed in ["Small", "Large"]:
            notes_feed = binned[binned["feed_bucket"] == feed]
            g = per_routine_metric(notes_feed, numer_type)
            if len(g) < 3:
                print(f"[{feed}] only {len(g)} routines with base notes — skipping")
                continue
            slope, _, pearson, spearman = plot_scatter(
                g, feed, ylabel, HERE / f"{metric}_scatter_{feed.lower()}.png")
            plot_pooled(notes_feed, feed, numer_type, ylabel,
                        HERE / f"{metric}_pooled_{feed.lower()}.png")
            g.sort_values("routine_start").to_csv(
                HERE / f"{metric}_per_routine_{feed.lower()}.csv", index=False)
            print(f"[{feed}] {len(g)} routines, {int(g['denom'].sum())} base notes, "
                  f"{int(g['numer'].sum())} {numer_type}  "
                  f"(rate={g['numer'].sum()/g['denom'].sum():.3f})  |  "
                  f"Pearson r={pearson:.3f}  Spearman ρ={spearman:.3f}  "
                  f"R²={pearson**2:.3f}  slope={slope:.2e}/min")


if __name__ == "__main__":
    main()
