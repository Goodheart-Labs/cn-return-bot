"""Plot the distribution of not-helpful ("bad") rating tags on our notes.

For each of X's not-helpful rating reasons we draw one histogram. Source:
note_ratings_from_public_dump.not_helpful_tag_counts (JSONB tag -> count, one
row per note; all rows are our author's notes).

Three outputs:
  1. tag_prevalence_bar.png   — total ratings per reason + # notes that got it
  2. fraction_histograms.png  — per reason: share of a note's not-helpful ratings
                                citing that reason (over notes w/ >=1 NH rating).
                                Normalises out raw view/rating volume.
  3. count_histograms.png     — per reason: raw per-note count (log y), among
                                notes that got the reason >=1 time (the tail).

Run: uv run src/scripts_jim/2026_06_18_bad_rating_distribution/plot.py
"""

import os
import re
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000


def fetch_all():
    """One row per note (latest dump). Paginate past PostgREST's 1000-row cap."""
    latest = {}  # note_id -> (dump_date, row)
    offset = 0
    while True:
        rows = (
            sb.table("note_ratings_from_public_dump")
            .select("note_id, not_helpful_count, not_helpful_tag_counts, dump_date")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
        )
        for r in rows:
            nid, d = r["note_id"], r["dump_date"] or ""
            if nid not in latest or d > latest[nid][0]:
                latest[nid] = (d, r)
        if len(rows) < PAGE:
            break
        offset += PAGE
    return [row for _, row in latest.values()]


def pretty(tag: str) -> str:
    """notHelpfulSourcesMissingOrUnreliable -> 'Sources Missing Or Unreliable'."""
    body = re.sub(r"^notHelpful", "", tag)
    return re.sub(r"(?<!^)(?=[A-Z])", " ", body)


rows = fetch_all()
nh_rated = [r for r in rows if (r.get("not_helpful_count") or 0) > 0]
print(f"notes: {len(rows)}; with >=1 not-helpful rating: {len(nh_rated)}")

# overall prevalence (total ratings + # notes), and per-note raw counts (where >=1)
tag_total = defaultdict(int)
tag_notes = defaultdict(int)
counts = defaultdict(list)
for r in nh_rated:
    for tag, c in (r.get("not_helpful_tag_counts") or {}).items():
        if c and c > 0:
            tag_total[tag] += c
            tag_notes[tag] += 1
            counts[tag].append(c)

TAGS = sorted(tag_total, key=lambda t: -tag_total[t])

# Per-note share of a note's not-helpful ratings citing each reason (0 when absent),
# one entry per nh_rated note so every histogram covers the same denominator.
fractions = {t: [] for t in TAGS}
for r in nh_rated:
    nh = r["not_helpful_count"] or 0
    tags = r.get("not_helpful_tag_counts") or {}
    for t in TAGS:
        c = tags.get(t) or 0
        fractions[t].append(min(c / nh, 1.0) if nh else 0.0)

# ---------- 1. prevalence bar ----------
fig, ax = plt.subplots(figsize=(10, 6))
y = np.arange(len(TAGS))
totals = [tag_total[t] for t in TAGS]
ax.barh(y, totals, color="#d62728", alpha=0.85)
ax.set_yticks(y)
ax.set_yticklabels([pretty(t) for t in TAGS])
ax.invert_yaxis()
ax.set_xlabel("Total not-helpful ratings citing this reason")
ax.set_title("Why raters mark our notes not helpful — overall volume\n"
             f"(our notes, latest public dump; {len(nh_rated)} notes with ≥1 not-helpful rating)")
for yi, t in enumerate(TAGS):
    ax.annotate(f"{tag_total[t]:,}  ({tag_notes[t]} notes)", (tag_total[t], yi),
                xytext=(5, 0), textcoords="offset points", va="center", fontsize=8)
ax.margins(x=0.18)
ax.grid(True, axis="x", alpha=0.3)
fig.tight_layout()
fig.savefig(HERE / "tag_prevalence_bar.png", dpi=150)
print("saved tag_prevalence_bar.png")

# ---------- 2. fraction histograms ----------
NCOLS = 2
NROWS = -(-len(TAGS) // NCOLS)
fig, axes = plt.subplots(NROWS, NCOLS, figsize=(12, 3.0 * NROWS))
axes = axes.flatten()
bins = np.linspace(0, 1, 21)
for i, t in enumerate(TAGS):
    ax = axes[i]
    vals = fractions[t]
    med = float(np.median(vals))
    ax.hist(vals, bins=bins, color="#d62728", alpha=0.8)
    ax.set_title(f"{pretty(t)}  (median share {med:.0%})", fontsize=10)
    ax.set_xlim(0, 1)
    ax.grid(True, axis="y", alpha=0.3)
    if i % NCOLS == 0:
        ax.set_ylabel("# notes")
    if i >= len(TAGS) - NCOLS:
        ax.set_xlabel("share of note's not-helpful ratings")
for j in range(len(TAGS), len(axes)):
    axes[j].axis("off")
fig.suptitle("Distribution of bad-rating reasons across our notes\n"
             "(per note: fraction of its not-helpful ratings citing each reason; notes with ≥1 NH rating)",
             fontsize=13)
fig.tight_layout(rect=(0, 0, 1, 0.97))
fig.savefig(HERE / "fraction_histograms.png", dpi=150)
print("saved fraction_histograms.png")

# ---------- 3. raw-count histograms (the tail) ----------
fig, axes = plt.subplots(NROWS, NCOLS, figsize=(12, 3.0 * NROWS))
axes = axes.flatten()
for i, t in enumerate(TAGS):
    ax = axes[i]
    vals = counts[t]
    cap = int(np.percentile(vals, 95))
    cap = max(cap, 10)
    clipped = np.clip(vals, 0, cap)
    ax.hist(clipped, bins=np.arange(0, cap + 2) - 0.5, color="#9467bd", alpha=0.8)
    ax.set_yscale("log")
    ax.set_title(f"{pretty(t)}  (n={len(vals)} notes, max {max(vals)})", fontsize=10)
    ax.grid(True, axis="y", alpha=0.3)
    if i % NCOLS == 0:
        ax.set_ylabel("# notes (log)")
    if i >= len(TAGS) - NCOLS:
        ax.set_xlabel(f"times reason applied per note (clipped at p95)")
for j in range(len(TAGS), len(axes)):
    axes[j].axis("off")
fig.suptitle("Per-note count of each bad-rating reason — among notes that got it\n"
             "(raw counts; x clipped at the 95th pct, y log-scaled to show the tail)",
             fontsize=13)
fig.tight_layout(rect=(0, 0, 1, 0.97))
fig.savefig(HERE / "count_histograms.png", dpi=150)
print("saved count_histograms.png")
