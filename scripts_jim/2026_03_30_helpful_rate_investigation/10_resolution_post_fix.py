"""Resolution rate by day, focusing on post-March-16 fix period."""
import os
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def fetch_all(table, select, filters=None):
    rows, offset = [], 0
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.range(offset, offset + 999).execute()
        rows.extend(resp.data)
        if len(resp.data) < 1000: break
        offset += 1000
    return rows

notes = fetch_all("notes", "note_id, bot_name, submitted_at")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status, first_non_nmr_at")
canon_map = {n["note_id"]: n for n in canonical}

def classify(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

# Daily resolution rate
print("=== DAILY RESOLUTION RATE (notes table) ===")
day_data = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
for n in notes:
    dt = (n.get("submitted_at") or "")[:10]
    if not dt: continue
    s = classify(n.get("note_id"))
    day_data[dt][s] += 1

print(f"{'Date':>12} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'Resolved%':>10} {'H/(H+UH)':>10}  {'Age(d)':>7}")
today = datetime(2026, 3, 30)
for d in sorted(day_data.keys()):
    if d < "2026-02-01": continue
    dd = day_data[d]
    h, uh, nmr = dd["helpful"], dd["unhelpful"], dd["nmr"]
    total = h + uh + nmr
    resolved = f"{(h+uh)/total*100:.0f}%" if total else "N/A"
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    age = (today - datetime.fromisoformat(d)).days
    marker = " <-- fix" if d == "2026-03-16" else ""
    print(f"{d:>12} {h:>4} {uh:>4} {nmr:>5} {total:>5} {resolved:>10} {ratio:>10}  {age:>5}d{marker}")

# Also bucket into meaningful periods
print("\n=== RESOLUTION RATE BY PERIOD ===")
periods = [
    ("Jan 7 - Feb 9 (good era)", "2026-01-07", "2026-02-10"),
    ("Feb 10 - Feb 15 (bot mix shift)", "2026-02-10", "2026-02-16"),
    ("Feb 16 - Mar 3 (citations breaking)", "2026-02-16", "2026-03-04"),
    ("Mar 4 - Mar 15 (pre-fix)", "2026-03-04", "2026-03-16"),
    ("Mar 16 - Mar 23 (post-fix week 1)", "2026-03-16", "2026-03-24"),
    ("Mar 24 - Mar 30 (post-fix week 2)", "2026-03-24", "2026-03-31"),
]

for label, start, end in periods:
    h, uh, nmr = 0, 0, 0
    for n in notes:
        dt = (n.get("submitted_at") or "")
        if dt < start or dt >= end: continue
        s = classify(n.get("note_id"))
        if s == "helpful": h += 1
        elif s == "unhelpful": uh += 1
        else: nmr += 1
    total = h + uh + nmr
    if total == 0: continue
    resolved = f"{(h+uh)/total*100:.0f}%"
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    age_start = (today - datetime.fromisoformat(start)).days
    print(f"  {label:>45}: {total:>4} notes, {h}H/{uh}UH/{nmr}NMR, resolved={resolved}, H/(H+UH)={ratio}, age≥{age_start}d")
