"""
Overview: weekly helpful/unhelpful rates over time.
Identifies the shift around mid-Feb 2026.
"""
import os, json
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# Pull all notes with status info from canonical_note_information
# We need: note_id, first_seen_at, cn_status, current_decided_by, classification,
# helpful_count, not_helpful_count, view_count, data_tier
print("Fetching canonical_note_information...")
all_notes = []
page_size = 1000
offset = 0
while True:
    resp = sb.table("canonical_note_information").select(
        "note_id, first_seen_at, cn_status, current_decided_by, classification, "
        "helpful_count, not_helpful_count, rating_count, "
        "view_count, data_tier, first_non_nmr_status, most_recent_non_nmr_status, "
        "locked_status, top_helpful_tag, top_not_helpful_tag"
    ).range(offset, offset + page_size - 1).execute()
    all_notes.extend(resp.data)
    if len(resp.data) < page_size:
        break
    offset += page_size

print(f"Total notes: {len(all_notes)}")

# Parse dates and bucket by week
from datetime import datetime, timedelta
from collections import defaultdict

weekly = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0, "unknown": 0, "total": 0})

for n in all_notes:
    dt_str = n.get("first_seen_at")
    if not dt_str:
        continue
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    # Week start (Monday)
    week_start = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")

    weekly[week_start]["total"] += 1

    status = n.get("cn_status") or ""
    decided = n.get("current_decided_by") or ""
    classification = n.get("classification") or ""
    locked = n.get("locked_status") or ""
    first_non_nmr = n.get("first_non_nmr_status") or ""
    most_recent = n.get("most_recent_non_nmr_status") or ""

    # Determine outcome - use the best available status
    effective_status = locked or most_recent or first_non_nmr or classification or status

    if "helpful" in effective_status.lower() and "not" not in effective_status.lower():
        weekly[week_start]["helpful"] += 1
    elif "not_helpful" in effective_status.lower() or "unhelpful" in effective_status.lower():
        weekly[week_start]["unhelpful"] += 1
    elif "nmr" in effective_status.lower() or effective_status == "" or "needs_more" in effective_status.lower():
        weekly[week_start]["nmr"] += 1
    else:
        weekly[week_start]["unknown"] += 1

print("\n=== WEEKLY HELPFUL/UNHELPFUL RATES ===")
print(f"{'Week':>12} {'Total':>6} {'Helpful':>8} {'Unhelpful':>10} {'NMR':>6} {'Unk':>5} {'H Rate':>8} {'UH Rate':>8} {'H/(H+UH)':>10}")
print("-" * 95)

for week in sorted(weekly.keys()):
    d = weekly[week]
    h, uh, nmr, unk, total = d["helpful"], d["unhelpful"], d["nmr"], d["unknown"], d["total"]
    h_rate = f"{h/total*100:.1f}%" if total else "N/A"
    uh_rate = f"{uh/total*100:.1f}%" if total else "N/A"
    h_ratio = f"{h/(h+uh)*100:.1f}%" if (h+uh) > 0 else "N/A"
    marker = " <--" if "2026-02" in week else ""
    print(f"{week:>12} {total:>6} {h:>8} {uh:>10} {nmr:>6} {unk:>5} {h_rate:>8} {uh_rate:>8} {h_ratio:>10}{marker}")

# Also show the raw statuses to understand the data
print("\n=== STATUS DISTRIBUTION ===")
status_counts = defaultdict(int)
for n in all_notes:
    s = n.get("cn_status") or "NULL"
    status_counts[s] += 1
for s, c in sorted(status_counts.items(), key=lambda x: -x[1]):
    print(f"  {s}: {c}")

print("\n=== CLASSIFICATION DISTRIBUTION ===")
class_counts = defaultdict(int)
for n in all_notes:
    s = n.get("classification") or "NULL"
    class_counts[s] += 1
for s, c in sorted(class_counts.items(), key=lambda x: -x[1]):
    print(f"  {s}: {c}")

print("\n=== LOCKED_STATUS DISTRIBUTION ===")
locked_counts = defaultdict(int)
for n in all_notes:
    s = n.get("locked_status") or "NULL"
    locked_counts[s] += 1
for s, c in sorted(locked_counts.items(), key=lambda x: -x[1]):
    print(f"  {s}: {c}")

print("\n=== FIRST_NON_NMR_STATUS DISTRIBUTION ===")
fnmr_counts = defaultdict(int)
for n in all_notes:
    s = n.get("first_non_nmr_status") or "NULL"
    fnmr_counts[s] += 1
for s, c in sorted(fnmr_counts.items(), key=lambda x: -x[1]):
    print(f"  {s}: {c}")

print("\n=== TOP NOT-HELPFUL TAGS (for unhelpful notes) ===")
tag_counts = defaultdict(int)
for n in all_notes:
    effective = (n.get("locked_status") or n.get("most_recent_non_nmr_status") or
                 n.get("first_non_nmr_status") or n.get("classification") or n.get("cn_status") or "")
    if "not_helpful" in effective.lower() or "unhelpful" in effective.lower():
        tag = n.get("top_not_helpful_tag") or "NULL"
        tag_counts[tag] += 1
for t, c in sorted(tag_counts.items(), key=lambda x: -x[1]):
    print(f"  {t}: {c}")
