"""
New note vs. retry: helpfulness rates since March 2026.

For each submitted note, count how many pipeline_runs exist for that tweet_id
before this note's submission. If 0 prior submissions => "new". Otherwise => "retry".
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

CUTOFF = "2026-03-01T00:00:00Z"


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


# Fetch pipeline_runs with submissions
print("Fetching pipeline_runs...")
all_runs = fetch_all("pipeline_runs", "tweet_id, note_id, outcome, created_at")
print(f"  {len(all_runs)} total runs")

# Build: for each tweet_id, ordered list of submissions
submissions_by_tweet = defaultdict(list)
for r in all_runs:
    if r.get("note_id") and r["outcome"] in ("submitted", "candidate"):
        submissions_by_tweet[r["tweet_id"]].append(r)

for tid in submissions_by_tweet:
    submissions_by_tweet[tid].sort(key=lambda r: r["created_at"])

# Fetch canonical_note_information with all status fields
print("Fetching canonical_note_information...")
cni = fetch_all(
    "canonical_note_information",
    "note_id, tweet_id, cn_status, current_decided_by, most_recent_non_nmr_status, "
    "first_non_nmr_status, classification, submitted_at, view_count, status_updated_at",
)
print(f"  {len(cni)} canonical notes")

# Also fetch notes table for potentially more up-to-date status
print("Fetching notes table...")
notes_table = fetch_all(
    "notes",
    "note_id, tweet_id, cn_status, helpful_count, not_helpful_count, "
    "somewhat_helpful_count, submitted_at, view_count",
)
print(f"  {len(notes_table)} notes")

cni_by_id = {n["note_id"]: n for n in cni}
notes_by_id = {n["note_id"]: n for n in notes_table}


def resolve_status(note_id):
    """Determine helpful/unhelpful/nmr using best available data."""
    cn = cni_by_id.get(note_id, {})
    nt = notes_by_id.get(note_id, {})

    # Check cn_status from canonical (most authoritative)
    for status_field in [
        cn.get("cn_status"),
        cn.get("most_recent_non_nmr_status"),
        cn.get("first_non_nmr_status"),
        nt.get("cn_status"),
    ]:
        if not status_field:
            continue
        s = status_field.lower()
        if "helpful" in s and "not" not in s:
            return "helpful"
        if "not" in s and "helpful" in s:
            return "not_helpful"

    # Check classification field
    cls = (cn.get("classification") or "").lower()
    if cls == "helpful":
        return "helpful"
    if cls in ("not_helpful", "not helpful"):
        return "not_helpful"

    return "nmr"


# Classify each submitted note since March as new or retry
new_notes = []
retry_notes = []

for tid, subs in submissions_by_tweet.items():
    for i, run in enumerate(subs):
        if run["created_at"] < CUTOFF:
            continue
        note_id = run["note_id"]
        status = resolve_status(note_id)
        entry = {"note_id": note_id, "status": status, "tweet_id": tid}
        if i == 0:
            new_notes.append(entry)
        else:
            retry_notes.append(entry)


def summarize(label, entries):
    total = len(entries)
    helpful = sum(1 for e in entries if e["status"] == "helpful")
    not_helpful = sum(1 for e in entries if e["status"] == "not_helpful")
    nmr = total - helpful - not_helpful
    resolved = helpful + not_helpful

    print(f"\n  {label}")
    print(f"  {'─'*40}")
    print(f"  Total submitted:    {total}")
    print(f"  Helpful:            {helpful}")
    print(f"  Not helpful:        {not_helpful}")
    print(f"  NMR (unresolved):   {nmr}")
    if resolved:
        print(f"  Helpful rate:       {helpful/resolved*100:.1f}%  ({helpful}/{resolved} resolved)")
    if total:
        print(f"  Helpful/total:      {helpful/total*100:.1f}%  ({helpful}/{total} total)")


print(f"\n{'='*55}")
print(f"  SINCE MARCH 1, 2026")
print(f"{'='*55}")
summarize("NEW NOTES (first attempt on tweet)", new_notes)
summarize("RETRY NOTES (2nd+ attempt on tweet)", retry_notes)

# Monthly breakdown
print(f"\n\n{'='*55}")
print("  MONTHLY BREAKDOWN")
print(f"{'='*55}")
print(f"\n{'Month':<8} {'Type':<8} {'Total':>6} {'Helpful':>8} {'NotHelp':>8} {'NMR':>5} {'HelpRate':>10}")
print("─" * 60)

for month_label, month_start, month_end in [
    ("Mar", "2026-03-01", "2026-04-01"),
    ("Apr", "2026-04-01", "2026-05-01"),
]:
    for label, entries in [("New", new_notes), ("Retry", retry_notes)]:
        # Use pipeline run created_at (already filtered by CUTOFF)
        # Re-filter by checking canonical submitted_at or just run created_at
        in_month = []
        for e in entries:
            cn = cni_by_id.get(e["note_id"], {})
            nt = notes_by_id.get(e["note_id"], {})
            sub_at = cn.get("submitted_at") or nt.get("submitted_at") or ""
            if not sub_at:
                # Fallback: check pipeline run created_at from submissions
                for tid_subs in submissions_by_tweet.get(e["tweet_id"], []):
                    if tid_subs["note_id"] == e["note_id"]:
                        sub_at = tid_subs["created_at"]
                        break
            if sub_at and month_start <= sub_at < month_end:
                in_month.append(e)

        total = len(in_month)
        helpful = sum(1 for e in in_month if e["status"] == "helpful")
        not_helpful = sum(1 for e in in_month if e["status"] == "not_helpful")
        nmr = total - helpful - not_helpful
        resolved = helpful + not_helpful
        rate = f"{helpful/resolved*100:.1f}%" if resolved else "N/A"
        print(f"{month_label:<8} {label:<8} {total:>6} {helpful:>8} {not_helpful:>8} {nmr:>5} {rate:>10}")

# Debug: show cn_status distribution for NMR notes
print(f"\n\n{'='*55}")
print("  STATUS DISTRIBUTION (all notes since March)")
print(f"{'='*55}")
status_dist = defaultdict(int)
for e in new_notes + retry_notes:
    cn = cni_by_id.get(e["note_id"], {})
    status_dist[cn.get("cn_status") or "NULL"] += 1
for s, count in sorted(status_dist.items(), key=lambda x: -x[1]):
    print(f"  {s:<40} {count:>5}")
