"""Eval score histogram for notes that became candidates."""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

BUCKETS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, float("inf"))]
LABELS = ["0.0–0.2", "0.2–0.4", "0.4–0.6", "0.6–0.8", "0.8+"]


def fetch_all(table, select, filters=None):
    rows, offset, page = [], 0, 1000
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.range(offset, offset + page - 1).execute()
        rows.extend(resp.data)
        if len(resp.data) < page:
            break
        offset += page
    return rows


# Candidate = outcome is candidate or submitted (both were candidates at some point)
runs = fetch_all(
    "pipeline_runs", "id, outcome",
    [("outcome", "in", "(candidate,submitted)")]
)
run_ids = {r["id"] for r in runs}
print(f"Candidate runs: {len(run_ids)}")

scores = fetch_all(
    "pipeline_scores", "pipeline_run_id, score_value",
    [("score_type", "eq", "evaluation")]
)
eval_scores = [
    float(s["score_value"]) for s in scores
    if s["pipeline_run_id"] in run_ids and s["score_value"] is not None
]
print(f"Eval scores found: {len(eval_scores)}")

counts = [0] * len(BUCKETS)
for v in eval_scores:
    for i, (lo, hi) in enumerate(BUCKETS):
        if lo <= v < hi:
            counts[i] += 1
            break

for label, count in zip(LABELS, counts):
    print(f"  {label}: {count}")

plt.bar(LABELS, counts, edgecolor="black")
plt.xlabel("Eval score")
plt.ylabel("Count")
plt.title("Eval score distribution for candidate notes")
for i, c in enumerate(counts):
    plt.text(i, c + 0.5, str(c), ha="center")
out = Path(__file__).parent / "eval_histogram.png"
plt.tight_layout()
plt.savefig(out, dpi=150)
print(f"Saved to {out}")
