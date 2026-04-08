"""
Equal-weight histograms of P(helpful) vs various predictors:
  - evaluation_score (from notes table)
  - tweet_impressions (from pipeline_runs)
  - each score_type in pipeline_scores

Uses exponential recency weighting (30-day half-life).
Bins are set so each contains equal total weight.
"""
import os
import math
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HALF_LIFE_DAYS = 30
ALPHA = math.log(2) / HALF_LIFE_DAYS
NUM_BINS = 5
NOW = datetime.now()


def fetch_all(table, select, **kwargs):
    rows = []
    offset = 0
    while True:
        q = sb.table(table).select(select).range(offset, offset + 999)
        for k, v in kwargs.items():
            if k == "not_null":
                q = q.not_.is_(v, "null")
            elif k == "neq":
                col, val = v
                q = q.neq(col, val)
        resp = q.execute()
        rows.extend(resp.data)
        if len(resp.data) < 1000:
            break
        offset += 1000
    return rows


def weight(dt_str):
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    age_days = (NOW - dt).total_seconds() / 86400
    return math.exp(-ALPHA * age_days)


def classify_outcome(note_id, canonical_map):
    c = canonical_map.get(note_id, {})
    raw = (
        c.get("locked_status")
        or c.get("most_recent_non_nmr_status")
        or c.get("first_non_nmr_status")
        or c.get("classification")
        or c.get("cn_status")
        or ""
    )
    s = raw.lower()
    if "currently_rated_helpful" in s and "not" not in s:
        return "helpful"
    if "not_helpful" in s:
        return "unhelpful"
    if "helpful" in s and "not" not in s:
        return "helpful"
    return "nmr"


def build_equal_weight_bins(data_points, num_bins=NUM_BINS):
    """
    data_points: list of (value, weight, is_helpful)
    Returns bins with equal total weight.
    """
    if not data_points:
        return []

    sorted_pts = sorted(data_points, key=lambda x: x[0])
    total_weight = sum(w for _, w, _ in sorted_pts)
    target_per_bin = total_weight / num_bins

    bins = []
    bin_start_idx = 0
    cum_w = 0.0
    cum_helpful = 0.0

    for i, (val, w, helpful) in enumerate(sorted_pts):
        cum_w += w
        if helpful:
            cum_helpful += w

        is_last = i == len(sorted_pts) - 1
        bin_full = cum_w >= target_per_bin and len(bins) < num_bins - 1

        if bin_full or is_last:
            lo = sorted_pts[bin_start_idx][0]
            hi = val
            reward = cum_helpful / cum_w if cum_w > 0 else 0
            bins.append({
                "lo": lo,
                "hi": hi,
                "midpoint": (lo + hi) / 2,
                "w_helpful": cum_helpful,
                "w_total": cum_w,
                "reward": reward,
                "n_raw": i - bin_start_idx + 1,
            })
            bin_start_idx = i + 1
            cum_w = 0.0
            cum_helpful = 0.0

    return bins


def print_histogram(name, bins, total_weight):
    if not bins:
        print(f"\n=== {name}: NO DATA ===")
        return

    print(f"\n=== {name} ===")
    print(f"  {'Bin range':>20} | {'n':>5} | {'eff.n':>6} | {'w.help':>6} | r(s)=P(H)")
    print("  " + "-" * 62)
    for b in bins:
        print(
            f"  {b['lo']:>9.3f} - {b['hi']:<7.3f} | {b['n_raw']:>5} | {b['w_total']:>6.1f} | {b['w_helpful']:>6.1f} | {b['reward']:.3f}"
        )


# ── Fetch data ───────────────────────────────────────────────────────

print("Fetching notes...")
notes = fetch_all("notes", "note_id, evaluation_score, submitted_at", not_null="evaluation_score")
print(f"  {len(notes)} notes with eval scores")

print("Fetching canonical outcomes...")
canonical_rows = fetch_all(
    "canonical_note_information",
    "note_id, cn_status, most_recent_non_nmr_status, locked_status, first_non_nmr_status, classification",
)
canonical = {r["note_id"]: r for r in canonical_rows}
print(f"  {len(canonical)} canonical records")

print("Fetching pipeline_runs (with tweet_impressions)...")
pipeline_runs = fetch_all(
    "pipeline_runs",
    "id, tweet_id, outcome, created_at, tweet_impressions",
)
print(f"  {len(pipeline_runs)} pipeline runs")

# Build note_id -> submitted_at lookup for submitted runs
# For pipeline_runs, the "date" for weighting is created_at
# We need to link pipeline_runs to notes to get outcomes
# pipeline_runs with outcome=submitted have a note in the notes table with the same tweet_id

print("Fetching pipeline_scores...")
pipeline_scores = fetch_all("pipeline_scores", "pipeline_run_id, score_type, score_value")
print(f"  {len(pipeline_scores)} score records")

# Build pipeline_run_id -> scores map
run_scores = {}
for s in pipeline_scores:
    rid = s["pipeline_run_id"]
    if rid not in run_scores:
        run_scores[rid] = {}
    if s["score_value"] is not None:
        run_scores[rid][s["score_type"]] = float(s["score_value"])

# Build note_id -> note lookup
note_by_id = {n["note_id"]: n for n in notes}

# Build tweet_id -> note_id for submitted notes
# We need notes table with tweet_id
print("Fetching notes with tweet_id...")
notes_with_tweet = fetch_all("notes", "note_id, tweet_id, submitted_at")
tweet_to_note = {}
for n in notes_with_tweet:
    if n["tweet_id"]:
        tweet_to_note[n["tweet_id"]] = n["note_id"]

# Build pipeline_run_id -> (note_id, created_at) for submitted runs
run_to_note = {}
for r in pipeline_runs:
    if r["outcome"] == "submitted" and r["tweet_id"] in tweet_to_note:
        run_to_note[r["id"]] = {
            "note_id": tweet_to_note[r["tweet_id"]],
            "created_at": r["created_at"],
            "tweet_impressions": r.get("tweet_impressions"),
        }

# ── Histogram 1: evaluation_score ────────────────────────────────────

print("\n" + "=" * 80)
print("Building histograms...")

eval_points = []
for n in notes:
    score = n["evaluation_score"]
    if score is None:
        continue
    w = weight(n["submitted_at"])
    is_helpful = classify_outcome(n["note_id"], canonical) == "helpful"
    eval_points.append((float(score), w, is_helpful))

eval_bins = build_equal_weight_bins(eval_points)
total_w = sum(w for _, w, _ in eval_points)
print_histogram("evaluation_score (from notes table)", eval_bins, total_w)

# ── Histogram 2: tweet_impressions ───────────────────────────────────

imp_points = []
for run_id, info in run_to_note.items():
    run = next((r for r in pipeline_runs if r["id"] == run_id), None)
    if not run or run["tweet_impressions"] is None:
        continue
    imp = run["tweet_impressions"]
    if imp <= 0:
        continue
    w = weight(info["created_at"])
    is_helpful = classify_outcome(info["note_id"], canonical) == "helpful"
    imp_points.append((math.log10(imp), w, is_helpful))

imp_bins = build_equal_weight_bins(imp_points)
total_w_imp = sum(w for _, w, _ in imp_points)
print_histogram("log10(tweet_impressions)", imp_bins, total_w_imp)

# ── Histogram 3+: each score_type in pipeline_scores ─────────────────

# Collect all score types that exist for submitted runs
score_types = set()
for run_id in run_to_note:
    if run_id in run_scores:
        score_types.update(run_scores[run_id].keys())

for score_type in sorted(score_types):
    points = []
    for run_id, info in run_to_note.items():
        scores = run_scores.get(run_id, {})
        if score_type not in scores:
            continue
        val = scores[score_type]
        w = weight(info["created_at"])
        is_helpful = classify_outcome(info["note_id"], canonical) == "helpful"
        points.append((val, w, is_helpful))

    if len(points) < NUM_BINS * 2:
        print(f"\n=== pipeline_scores.{score_type}: SKIPPED (only {len(points)} data points) ===")
        continue

    bins = build_equal_weight_bins(points)
    total_w_s = sum(w for _, w, _ in points)
    print_histogram(f"pipeline_scores.{score_type}", bins, total_w_s)

print("\nDone.")
