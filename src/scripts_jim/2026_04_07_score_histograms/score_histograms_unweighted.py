"""
Equal-count histograms of P(helpful) vs various predictors.
No exponential weighting — raw counts only.
"""
import os
import math
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

NUM_BINS = 5


def fetch_all(table, select, **kwargs):
    rows = []
    offset = 0
    while True:
        q = sb.table(table).select(select).range(offset, offset + 999)
        for k, v in kwargs.items():
            if k == "not_null":
                q = q.not_.is_(v, "null")
        resp = q.execute()
        rows.extend(resp.data)
        if len(resp.data) < 1000:
            break
        offset += 1000
    return rows


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


def build_equal_count_bins(data_points, num_bins=NUM_BINS):
    """data_points: list of (value, is_helpful). Splits into equal-count bins."""
    if len(data_points) < num_bins:
        return []
    sorted_pts = sorted(data_points, key=lambda x: x[0])
    per_bin = len(sorted_pts) // num_bins

    bins = []
    for i in range(num_bins):
        start = i * per_bin
        end = len(sorted_pts) if i == num_bins - 1 else (i + 1) * per_bin
        chunk = sorted_pts[start:end]
        helpful = sum(1 for _, h in chunk if h)
        bins.append({
            "lo": chunk[0][0],
            "hi": chunk[-1][0],
            "n": len(chunk),
            "helpful": helpful,
            "reward": helpful / len(chunk),
        })
    return bins


def print_histogram(name, bins, total_n):
    if not bins:
        print(f"\n=== {name}: NO DATA ===")
        return
    print(f"\n=== {name} (n={total_n}) ===")
    print(f"  {'Bin range':>20} | {'n':>5} | {'helpful':>7} | {'r(s)':>6}")
    print("  " + "-" * 50)
    for b in bins:
        print(f"  {b['lo']:>9.3f} - {b['hi']:<7.3f} | {b['n']:>5} | {b['helpful']:>7} | {b['reward']:.3f}")


# ── Fetch data ───────────────────────────────────────────────────────

print("Fetching notes...")
notes = fetch_all("notes", "note_id, evaluation_score, submitted_at, tweet_id", not_null="evaluation_score")
print(f"  {len(notes)} notes with eval scores")

print("Fetching canonical outcomes...")
canonical_rows = fetch_all(
    "canonical_note_information",
    "note_id, cn_status, most_recent_non_nmr_status, locked_status, first_non_nmr_status, classification",
)
canonical = {r["note_id"]: r for r in canonical_rows}
print(f"  {len(canonical)} canonical records")

print("Fetching pipeline_runs...")
pipeline_runs = fetch_all("pipeline_runs", "id, tweet_id, outcome, tweet_impressions")
print(f"  {len(pipeline_runs)} pipeline runs")

print("Fetching pipeline_scores...")
pipeline_scores = fetch_all("pipeline_scores", "pipeline_run_id, score_type, score_value")
print(f"  {len(pipeline_scores)} score records")

# Build lookup maps
tweet_to_note = {n["tweet_id"]: n["note_id"] for n in notes if n.get("tweet_id")}
run_scores = {}
for s in pipeline_scores:
    rid = s["pipeline_run_id"]
    if rid not in run_scores:
        run_scores[rid] = {}
    if s["score_value"] is not None:
        run_scores[rid][s["score_type"]] = float(s["score_value"])

# Map submitted pipeline_runs -> note_id
run_to_note = {}
for r in pipeline_runs:
    if r["outcome"] == "submitted" and r["tweet_id"] in tweet_to_note:
        run_to_note[r["id"]] = {
            "note_id": tweet_to_note[r["tweet_id"]],
            "tweet_impressions": r.get("tweet_impressions"),
        }

# ── Histograms ───────────────────────────────────────────────────────

print("\n" + "=" * 60)

# 1. evaluation_score
eval_points = [
    (float(n["evaluation_score"]), classify_outcome(n["note_id"], canonical) == "helpful")
    for n in notes
]
print_histogram("evaluation_score", build_equal_count_bins(eval_points), len(eval_points))

# 2. tweet_impressions
imp_points = [
    (math.log10(info["tweet_impressions"]), classify_outcome(info["note_id"], canonical) == "helpful")
    for info in run_to_note.values()
    if info["tweet_impressions"] and info["tweet_impressions"] > 0
]
print_histogram("log10(tweet_impressions)", build_equal_count_bins(imp_points), len(imp_points))

# 3. Each pipeline score type
score_types = set()
for run_id in run_to_note:
    if run_id in run_scores:
        score_types.update(run_scores[run_id].keys())

for score_type in sorted(score_types):
    points = [
        (run_scores[rid][score_type], classify_outcome(info["note_id"], canonical) == "helpful")
        for rid, info in run_to_note.items()
        if rid in run_scores and score_type in run_scores[rid]
    ]
    if len(points) < NUM_BINS * 3:
        print(f"\n=== pipeline_scores.{score_type}: SKIPPED ({len(points)} pts) ===")
        continue
    print_histogram(f"pipeline_scores.{score_type}", build_equal_count_bins(points), len(points))

print("\nDone.")
