"""Step 2: median positive/negative ratings per submission-day, last 7 days w/ ratings.

Fresh rating counts come from `note_ratings_from_public_dump` (the table the review
dashboard reads — kept current by the public-dump ingest; the legacy
notes.helpful_count columns are frozen at Feb 2026 and must NOT be used).

For each eligible note (our submitted notes with eval score >= 0) we take its latest
dump row's helpful_count (positive) and not_helpful_count (negative), group notes by
submission day (notes.submitted_at, UTC), and report the MEDIAN positive and MEDIAN
negative across all eligible notes submitted that day. Plots the last 7 days with ratings.

Run: uv run src/scripts_jim/2026_06_16_ratings_per_day/step2_plot.py
"""

import os
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

LAST_N_DAYS = 7
BATCH = 400

note_ids = HERE.joinpath("note_ids.txt").read_text().split()
print(f"Eligible notes (eval >= 0): {len(note_ids)}")


def fetch_in_batches(table, cols):
    rows = []
    for i in range(0, len(note_ids), BATCH):
        rows += sb.table(table).select(cols).in_("note_id", note_ids[i : i + BATCH]).execute().data
    return rows


# fresh counts: keep the latest dump_date row per note
pos, neg = {}, {}
latest_dump = {}
for r in fetch_in_batches("note_ratings_from_public_dump", "note_id, helpful_count, not_helpful_count, dump_date"):
    nid, d = r["note_id"], r["dump_date"]
    if nid not in latest_dump or d > latest_dump[nid]:
        latest_dump[nid] = d
        pos[nid] = r["helpful_count"] or 0
        neg[nid] = r["not_helpful_count"] or 0
print(f"Eligible notes present in public-dump ratings: {len(pos)}")

# submission day per eligible note
submitted = {r["note_id"]: r["submitted_at"] for r in fetch_in_batches("notes", "note_id, submitted_at")}

# group all eligible notes by submission day; notes absent from the dump = 0 ratings
by_day = defaultdict(list)  # day -> list of (pos, neg)
for nid in note_ids:
    sa = submitted.get(nid)
    if not sa:
        continue
    day = datetime.fromisoformat(sa).astimezone(timezone.utc).date()
    by_day[day].append((pos.get(nid, 0), neg.get(nid, 0)))

# a day counts as "having ratings" only once a MAJORITY of its notes are rated;
# this excludes too-young days (e.g. notes 1-2 days old, mostly unrated in the dump)
# whose median would be an artificial 0.
MIN_RATED_FRACTION = 0.5
def rated_fraction(vals):
    return sum(1 for p, n in vals if p or n) / len(vals)

rated_days = sorted(d for d, vals in by_day.items() if rated_fraction(vals) >= MIN_RATED_FRACTION)
plot_days = rated_days[-LAST_N_DAYS:]

print(f"\n{'date':<12}{'#notes':>8}{'#rated':>8}{'med_pos':>9}{'med_neg':>9}")
table = []
for d in plot_days:
    vals = by_day[d]
    n_rated = sum(1 for p, n in vals if p or n)
    med_pos = statistics.median(p for p, _ in vals)
    med_neg = statistics.median(n for _, n in vals)
    table.append((d, len(vals), med_pos, med_neg))
    print(f"{d.isoformat():<12}{len(vals):>8}{n_rated:>8}{med_pos:>9.1f}{med_neg:>9.1f}")

# --- plot ---
labels = [d.isoformat() for d, *_ in table]
med_pos_y = [r[2] for r in table]
med_neg_y = [r[3] for r in table]

fig, ax = plt.subplots(figsize=(10, 6))
ax.plot(labels, med_pos_y, marker="o", color="#2ca02c", linewidth=2, label="Positive (helpful)")
ax.plot(labels, med_neg_y, marker="o", color="#d62728", linewidth=2, label="Negative (not helpful)")
for x, y in zip(labels, med_pos_y):
    ax.annotate(f"{y:g}", (x, y), textcoords="offset points", xytext=(0, 8), ha="center", color="#2ca02c", fontsize=9)
for x, y in zip(labels, med_neg_y):
    ax.annotate(f"{y:g}", (x, y), textcoords="offset points", xytext=(0, -14), ha="center", color="#d62728", fontsize=9)

ax.set_title("Median ratings per note by submission day\n(our notes, eval ≥ 0; counts from public-dump ratings, 2026-06-16)")
ax.set_xlabel("Submission date (UTC)")
ax.set_ylabel("Median ratings per note")
ax.legend()
ax.grid(True, axis="y", alpha=0.3)
ax.margins(y=0.18)
fig.autofmt_xdate(rotation=30)
fig.tight_layout()

out = HERE / "ratings_per_day.png"
fig.savefig(out, dpi=150)
print(f"\nSaved plot -> {out}")
