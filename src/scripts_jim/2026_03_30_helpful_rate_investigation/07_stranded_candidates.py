"""
How many candidates with positive eval scores never get submitted?
"Stranded candidates" - good notes that die in the queue.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from datetime import datetime, timezone, timedelta
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def fetch_all(table, select, filters=None):
    rows, offset, page = [], 0, 1000
    while True:
        q = sb.table(table).select(select).range(offset, offset + page - 1)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.execute()
        rows.extend(resp.data)
        if len(resp.data) < page:
            break
        offset += page
    return rows


# Fetch current candidates (outcome=candidate, still waiting)
print("Fetching current candidates...")
current_candidates = fetch_all("pipeline_runs",
    "id, tweet_id, outcome, created_at, bot_id",
    [("outcome", "eq", "candidate")])
print(f"  {len(current_candidates)} current candidates")

# Fetch submitted runs (to know which tweets already got a note through)
print("Fetching submitted runs...")
submitted = fetch_all("pipeline_runs",
    "id, tweet_id, created_at",
    [("outcome", "eq", "submitted")])
submitted_tweet_ids = {r["tweet_id"] for r in submitted}
print(f"  {len(submitted)} submitted ({len(submitted_tweet_ids)} unique tweets)")

# Fetch expired/rejected candidates
print("Fetching rejected candidates...")
rejected = fetch_all("pipeline_runs",
    "id, tweet_id, outcome_reason, created_at",
    [("outcome", "eq", "rejected")])
print(f"  {len(rejected)} rejected runs")

# Fetch eval scores
print("Fetching eval scores...")
scores = fetch_all("pipeline_scores",
    "pipeline_run_id, score_value",
    [("score_type", "eq", "evaluation")])
score_by_run = {s["pipeline_run_id"]: s["score_value"] for s in scores}
print(f"  {len(scores)} scores")

# Attach scores to candidates
for c in current_candidates:
    c["eval_score"] = score_by_run.get(c["id"])

now = datetime.now(timezone.utc)

# Group current candidates by tweet
by_tweet = defaultdict(list)
for c in current_candidates:
    by_tweet[c["tweet_id"]].append(c)

print(f"\n{'='*60}")
print(f"  CURRENT CANDIDATE POOL")
print(f"{'='*60}")
print(f"\nTotal candidate runs: {len(current_candidates)}")
print(f"Unique tweets with candidates: {len(by_tweet)}")
print(f"Of those, already have a submitted note: {sum(1 for t in by_tweet if t in submitted_tweet_ids)}")

# Focus on tweets that DON'T have a submitted note
stranded_tweets = {t: runs for t, runs in by_tweet.items() if t not in submitted_tweet_ids}
print(f"Truly stranded (no submitted note): {len(stranded_tweets)} tweets")

# Score distribution
all_best_scores = []
for tweet_id, runs in stranded_tweets.items():
    best = max((r["eval_score"] for r in runs if r["eval_score"] is not None), default=None)
    earliest = min(r["created_at"] for r in runs)
    dt = datetime.fromisoformat(earliest.replace("Z", "+00:00"))
    age_hours = (now - dt).total_seconds() / 3600
    all_best_scores.append({"tweet_id": tweet_id, "best_eval": best, "age_hours": age_hours, "n_candidates": len(runs)})

pos = [s for s in all_best_scores if s["best_eval"] is not None and s["best_eval"] > 0]
neg = [s for s in all_best_scores if s["best_eval"] is not None and s["best_eval"] <= 0]
no_score = [s for s in all_best_scores if s["best_eval"] is None]

print(f"\nStranded score breakdown:")
print(f"  Positive eval (>0): {len(pos)}")
print(f"  Non-positive (<=0): {len(neg)}")
print(f"  No score: {len(no_score)}")

if pos:
    scores_sorted = sorted([s["best_eval"] for s in pos], reverse=True)
    print(f"\n  Score distribution of stranded positive:")
    buckets = [(0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1.0), (1.0, 1.5), (1.5, float('inf'))]
    for lo, hi in buckets:
        count = sum(1 for s in scores_sorted if lo < s <= hi)
        if count:
            label = f"({lo}, {hi}]" if hi != float('inf') else f"({lo}, +inf)"
            print(f"    {label}: {count}")

    print(f"\n  Top 10: {[round(s, 3) for s in scores_sorted[:10]]}")
    print(f"  Avg eval: {sum(scores_sorted)/len(scores_sorted):.3f}")

    ages = sorted([s["age_hours"] for s in pos])
    print(f"\n  Age distribution:")
    age_buckets = [(0, 6), (6, 24), (24, 72), (72, 168), (168, float('inf'))]
    for lo, hi in age_buckets:
        count = sum(1 for a in ages if lo <= a < hi)
        label_map = {6: "<6h", 24: "6-24h", 72: "1-3d", 168: "3-7d"}
        label = label_map.get(hi, "7d+")
        if count:
            print(f"    {label}: {count}")

# Compare with submitted notes' eval scores
print(f"\n{'='*60}")
print(f"  COMPARISON: SUBMITTED vs STRANDED EVAL SCORES")
print(f"{'='*60}")

sub_scores = [score_by_run.get(r["id"]) for r in submitted if score_by_run.get(r["id"]) is not None]
if sub_scores:
    print(f"\nSubmitted notes eval scores (n={len(sub_scores)}):")
    print(f"  Avg: {sum(sub_scores)/len(sub_scores):.3f}")
    print(f"  Min: {min(sub_scores):.3f}, Max: {max(sub_scores):.3f}")

if pos:
    print(f"\nStranded positive eval scores (n={len(pos)}):")
    avg = sum(s["best_eval"] for s in pos) / len(pos)
    print(f"  Avg: {avg:.3f}")

# How many stranded candidates would have scored higher than the lowest submitted?
if sub_scores and pos:
    min_submitted = min(sub_scores)
    above_min = sum(1 for s in pos if s["best_eval"] >= min_submitted)
    print(f"\n  Stranded with score >= lowest submitted ({min_submitted:.3f}): {above_min}")

    # Past month submitted rate context
    month_submitted = [r for r in submitted if datetime.fromisoformat(
        r["created_at"].replace("Z", "+00:00")) >= now - timedelta(days=30)]
    print(f"\n  Submissions past 30 days: {len(month_submitted)}")
    print(f"  Stranded candidates right now: {len(pos)} positive-eval tweets")
    if month_submitted:
        daily_rate = len(month_submitted) / 30
        days_to_clear = len(pos) / daily_rate if daily_rate > 0 else float('inf')
        print(f"  Daily submission rate: {daily_rate:.1f}")
        print(f"  Days to clear current stranded backlog: {days_to_clear:.0f}")
