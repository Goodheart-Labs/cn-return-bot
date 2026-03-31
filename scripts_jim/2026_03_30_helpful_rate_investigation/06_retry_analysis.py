"""
Retry analysis: success rates by attempt number.
For each tweet, number pipeline_runs chronologically.
Track: submit rate, helpful/unhelpful rates by attempt number.
Time windows: all-time, past month, past week.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from datetime import datetime, timedelta, timezone
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


# Fetch pipeline_runs
print("Fetching pipeline_runs...")
runs = fetch_all("pipeline_runs", "tweet_id, outcome, outcome_reason, note_id, created_at, bot_id")
print(f"  {len(runs)} runs")

# Fetch canonical_note_information for status lookup
print("Fetching canonical_note_information...")
notes = fetch_all("canonical_note_information", "note_id, tweet_id, cn_status, current_decided_by, classification, view_count")
print(f"  {len(notes)} notes")

# Build note status lookup by tweet_id (a tweet can have multiple notes)
note_by_note_id = {n["note_id"]: n for n in notes}
notes_by_tweet = defaultdict(list)
for n in notes:
    if n.get("tweet_id"):
        notes_by_tweet[n["tweet_id"]].append(n)

# Group runs by tweet_id, sort by created_at
tweet_runs = defaultdict(list)
for r in runs:
    tweet_runs[r["tweet_id"]].append(r)

for tid in tweet_runs:
    tweet_runs[tid].sort(key=lambda r: r["created_at"])

# Time windows
now = datetime.now(timezone.utc)
windows = {
    "all_time": None,
    "past_month": now - timedelta(days=30),
    "past_week": now - timedelta(days=7),
}


def classify_note(note):
    """Classify a note as helpful, unhelpful, or nmr."""
    status = (note.get("cn_status") or "").lower()
    decided = (note.get("current_decided_by") or "").lower()
    if "helpful" in status and "not" not in status:
        return "helpful"
    if "not" in status and "helpful" in status:
        return "unhelpful"
    # Check current_decided_by
    if decided == "helpful":
        return "helpful"
    if decided in ("not helpful", "unhelpful"):
        return "unhelpful"
    return "nmr"


def note_status_for_run(run):
    """Get the note status for a submitted run."""
    if run.get("note_id") and run["note_id"] in note_by_note_id:
        return classify_note(note_by_note_id[run["note_id"]])
    return "unknown"


# Analyze by attempt number
for window_name, cutoff in windows.items():
    print(f"\n{'='*60}")
    print(f"  {window_name.upper().replace('_', ' ')}")
    print(f"{'='*60}")

    # attempt_num -> {total, submitted, candidate, rejected, filtered, failed, helpful, unhelpful, nmr}
    by_attempt = defaultdict(lambda: defaultdict(int))
    tweet_count = 0

    for tid, all_attempts in tweet_runs.items():
        # Use global attempt numbering, but only count runs in the window
        has_any = False
        for i, run in enumerate(all_attempts):
            attempt_num = i + 1
            dt = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
            if cutoff and dt < cutoff:
                continue
            if not has_any:
                has_any = True
                tweet_count += 1
            if attempt_num > 5:
                attempt_num = "5+"

            stats = by_attempt[attempt_num]
            stats["total"] += 1
            outcome = run["outcome"]
            stats[outcome] += 1

            if outcome == "submitted" or (outcome == "candidate" and run.get("note_id")):
                status = note_status_for_run(run)
                stats[f"note_{status}"] += 1

    print(f"\nUnique tweets with attempts: {tweet_count}")
    print(f"\n{'Attempt':<10} {'Total':>7} {'Submit':>7} {'Cand':>7} {'Reject':>7} {'Filter':>7} {'Failed':>7} | {'Submit%':>8} {'Help':>5} {'Unhelp':>6} {'NMR':>5}")
    print("-" * 105)

    for attempt_key in sorted(by_attempt.keys(), key=lambda x: (isinstance(x, str), x)):
        s = by_attempt[attempt_key]
        total = s["total"]
        submitted = s.get("submitted", 0)
        candidate = s.get("candidate", 0)
        rejected = s.get("rejected", 0)
        filtered = s.get("filtered", 0)
        failed = s.get("failed", 0)
        submit_pct = f"{submitted/total*100:.1f}%" if total else "N/A"
        helpful = s.get("note_helpful", 0)
        unhelpful = s.get("note_unhelpful", 0)
        nmr = s.get("note_nmr", 0) + s.get("note_unknown", 0)
        print(f"{str(attempt_key):<10} {total:>7} {submitted:>7} {candidate:>7} {rejected:>7} {filtered:>7} {failed:>7} | {submit_pct:>8} {helpful:>5} {unhelpful:>6} {nmr:>5}")

    # Summary: helpful rate among submitted
    print(f"\n--- Helpful rates among submitted notes ---")
    print(f"{'Attempt':<10} {'Submitted':>10} {'Helpful':>8} {'Unhelpful':>10} {'NMR':>8} {'Help%':>8} {'Unhelp%':>8}")
    print("-" * 70)
    for attempt_key in sorted(by_attempt.keys(), key=lambda x: (isinstance(x, str), x)):
        s = by_attempt[attempt_key]
        submitted = s.get("submitted", 0)
        helpful = s.get("note_helpful", 0)
        unhelpful = s.get("note_unhelpful", 0)
        nmr = s.get("note_nmr", 0) + s.get("note_unknown", 0)
        resolved = helpful + unhelpful
        help_pct = f"{helpful/resolved*100:.1f}%" if resolved else "N/A"
        unhelp_pct = f"{unhelpful/resolved*100:.1f}%" if resolved else "N/A"
        print(f"{str(attempt_key):<10} {submitted:>10} {helpful:>8} {unhelpful:>10} {nmr:>8} {help_pct:>8} {unhelp_pct:>8}")

    # Also show: how many tweets got to each attempt number
    max_attempts_dist = defaultdict(int)
    for tid, all_attempts in tweet_runs.items():
        # Total attempts for this tweet (global, not filtered)
        total = len(all_attempts)
        # But only count tweets that have at least one attempt in window
        if cutoff:
            has_in_window = any(
                datetime.fromisoformat(a["created_at"].replace("Z", "+00:00")) >= cutoff
                for a in all_attempts
            )
            if not has_in_window:
                continue
        n = min(total, 5)
        key = f"{n}+" if total > 5 else str(total)
        max_attempts_dist[key] += 1

    print(f"\n--- Tweets by max attempt count ---")
    for k in sorted(max_attempts_dist.keys()):
        print(f"  {k} attempts: {max_attempts_dist[k]} tweets")
