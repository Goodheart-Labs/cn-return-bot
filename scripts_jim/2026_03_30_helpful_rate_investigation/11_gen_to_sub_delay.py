"""Delay between candidate generation and submission vs resolution rate."""
import os
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone
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

# Get submitted pipeline runs (these were candidates that got submitted - same row, mutated)
# created_at = when candidate was generated
# We need to find when it was submitted. The notes table has submitted_at.
print("Fetching data...")
pipeline_runs = fetch_all("pipeline_runs",
    "id, tweet_id, note_id, outcome, created_at, bot_id",
    [("outcome", "eq", "submitted")])

notes = fetch_all("notes", "note_id, submitted_at, bot_name")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status")

canon_map = {n["note_id"]: n for n in canonical}
notes_map = {n["note_id"]: n for n in notes}

def classify(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

def parse_dt(s):
    if not s: return None
    s = s.replace("Z", "+00:00")
    try: return datetime.fromisoformat(s)
    except: return None

# Match pipeline_runs (created_at = generation time) to notes (submitted_at)
delays = []
for pr in pipeline_runs:
    nid = pr.get("note_id")
    if not nid: continue
    gen_dt = parse_dt(pr.get("created_at"))
    note = notes_map.get(nid, {})
    sub_dt = parse_dt(note.get("submitted_at"))
    if not gen_dt or not sub_dt: continue
    delay_h = (sub_dt - gen_dt).total_seconds() / 3600
    if delay_h < 0: continue  # data issue
    delays.append({
        "note_id": nid,
        "bot": note.get("bot_name") or pr.get("bot_id"),
        "gen_dt": gen_dt,
        "sub_dt": sub_dt,
        "delay_h": delay_h,
        "status": classify(nid),
    })

print(f"\nMatched {len(delays)} notes with gen→sub delay\n")

# Bucket by delay
buckets = [
    ("0-1h", 0, 1),
    ("1-3h", 1, 3),
    ("3-6h", 3, 6),
    ("6-12h", 6, 12),
    ("12-24h", 12, 24),
    ("24-48h", 24, 48),
    ("48h+", 48, 9999),
]

print("=== Gen-to-sub delay vs resolution rate (all matched) ===")
print(f"{'Delay':>8} {'Tot':>5} {'H':>4} {'UH':>4} {'NMR':>5} {'Resolved':>9} {'Resolved%':>10} {'H/(H+UH)':>10}")
for label, lo, hi in buckets:
    matched = [d for d in delays if lo <= d["delay_h"] < hi]
    h = sum(1 for d in matched if d["status"] == "helpful")
    uh = sum(1 for d in matched if d["status"] == "unhelpful")
    nmr = sum(1 for d in matched if d["status"] == "nmr")
    tot = len(matched)
    if tot == 0: continue
    res = h + uh
    res_pct = f"{res/tot*100:.0f}%"
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    print(f"{label:>8} {tot:>5} {h:>4} {uh:>4} {nmr:>5} {res:>9} {res_pct:>10} {ratio:>10}")

# Only candidate era (Mar 4+)
print("\n=== Gen-to-sub delay vs resolution rate (Mar 4+ only) ===")
print(f"{'Delay':>8} {'Tot':>5} {'H':>4} {'UH':>4} {'NMR':>5} {'Resolved':>9} {'Resolved%':>10} {'H/(H+UH)':>10}")
for label, lo, hi in buckets:
    matched = [d for d in delays if lo <= d["delay_h"] < hi and d["gen_dt"] >= datetime(2026, 3, 4, tzinfo=timezone.utc)]
    h = sum(1 for d in matched if d["status"] == "helpful")
    uh = sum(1 for d in matched if d["status"] == "unhelpful")
    nmr = sum(1 for d in matched if d["status"] == "nmr")
    tot = len(matched)
    if tot == 0: continue
    res = h + uh
    res_pct = f"{res/tot*100:.0f}%"
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    print(f"{label:>8} {tot:>5} {h:>4} {uh:>4} {nmr:>5} {res:>9} {res_pct:>10} {ratio:>10}")

# Also show delay distribution by period
print("\n=== Median gen-to-sub delay by period ===")
periods = [
    ("Pre-candidate (before Mar 4)", lambda d: d["gen_dt"] < datetime(2026, 3, 4, tzinfo=timezone.utc)),
    ("Mar 4-15 (pre-fix)", lambda d: datetime(2026, 3, 4, tzinfo=timezone.utc) <= d["gen_dt"] < datetime(2026, 3, 16, tzinfo=timezone.utc)),
    ("Mar 16-30 (post-fix)", lambda d: datetime(2026, 3, 16, tzinfo=timezone.utc) <= d["gen_dt"]),
]
for label, filt in periods:
    matched = [d for d in delays if filt(d)]
    if not matched:
        print(f"  {label}: no data")
        continue
    hours = sorted(d["delay_h"] for d in matched)
    med = hours[len(hours)//2]
    mean = sum(hours) / len(hours)
    print(f"  {label}: n={len(matched)}, median={med:.1f}h, mean={mean:.1f}h, range={hours[0]:.1f}-{hours[-1]:.1f}h")
