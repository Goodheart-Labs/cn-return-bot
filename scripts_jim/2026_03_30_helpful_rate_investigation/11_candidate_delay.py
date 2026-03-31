"""
Investigate candidate-to-submission delay and tweet-to-submission delay.
Check if delay correlates with approval rate.
"""
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

def parse_dt(s):
    if not s: return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

# Fetch data
print("Fetching data...")
runs = fetch_all("pipeline_runs",
    "id, note_id, tweet_id, created_at, outcome, bot_id",
    [("outcome", "eq", "submitted")])
notes = fetch_all("notes", "note_id, submitted_at, bot_name")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status")

configs = fetch_all("bot_configs", "id, name")
config_map = {c["id"]: c["name"] for c in configs}

note_submit_map = {n["note_id"]: n.get("submitted_at") for n in notes}
note_bot_map = {n["note_id"]: n.get("bot_name") for n in notes}
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

# Compute delays
records = []
for r in runs:
    nid = r.get("note_id")
    if not nid: continue
    generated_at = parse_dt(r.get("created_at"))
    submitted_at = parse_dt(note_submit_map.get(nid))
    if not generated_at: continue

    # Derive tweet time from Twitter snowflake ID
    tweet_time = None
    tid = r.get("tweet_id")
    if tid:
        try:
            tweet_ts_ms = (int(tid) >> 22) + 1288834974657
            tweet_time = datetime.fromtimestamp(tweet_ts_ms / 1000, tz=generated_at.tzinfo)
        except (ValueError, OSError):
            pass

    gen_to_sub_hours = None
    if submitted_at and generated_at:
        gen_to_sub_hours = (submitted_at - generated_at).total_seconds() / 3600

    tweet_to_sub_hours = None
    if submitted_at and tweet_time:
        tweet_to_sub_hours = (submitted_at - tweet_time).total_seconds() / 3600

    tweet_to_gen_hours = None
    if tweet_time and generated_at:
        tweet_to_gen_hours = (generated_at - tweet_time).total_seconds() / 3600

    records.append({
        "note_id": nid,
        "generated_at": generated_at,
        "submitted_at": submitted_at,
        "tweet_time": tweet_time,
        "gen_to_sub_h": gen_to_sub_hours,
        "tweet_to_sub_h": tweet_to_sub_hours,
        "tweet_to_gen_h": tweet_to_gen_hours,
        "bot": note_bot_map.get(nid) or config_map.get(r.get("bot_id"), "unknown"),
        "status": classify(nid),
    })

# === CANDIDATE-TO-SUBMISSION DELAY BY PERIOD ===
periods = [
    ("Jan 7 - Feb 9 (pre-refactor)", "2026-01-07", "2026-02-10"),
    ("Feb 10-15 (bot mix shift)", "2026-02-10", "2026-02-16"),
    ("Feb 16 - Mar 3 (citations breaking)", "2026-02-16", "2026-03-04"),
    ("Mar 4-15 (candidate system, pre-fix)", "2026-03-04", "2026-03-16"),
    ("Mar 16-23 (post-fix week 1)", "2026-03-16", "2026-03-24"),
    ("Mar 24-30 (post-fix week 2)", "2026-03-24", "2026-03-31"),
]

def stats_str(vals):
    if not vals: return "no data"
    vals = sorted(vals)
    n = len(vals)
    return f"n={n}, median={vals[n//2]:.1f}h, p25={vals[int(n*0.25)]:.1f}h, p75={vals[int(n*0.75)]:.1f}h, max={vals[-1]:.1f}h"

print("\n=== GENERATION-TO-SUBMISSION DELAY BY PERIOD ===")
for label, start, end in periods:
    delays = [r["gen_to_sub_h"] for r in records
              if r["submitted_at"] and start <= r["submitted_at"].isoformat() < end
              and r["gen_to_sub_h"] is not None]
    print(f"  {label}: {stats_str(delays)}")

print("\n=== TWEET-TO-SUBMISSION DELAY BY PERIOD ===")
for label, start, end in periods:
    delays = [r["tweet_to_sub_h"] for r in records
              if r["submitted_at"] and start <= r["submitted_at"].isoformat() < end
              and r["tweet_to_sub_h"] is not None]
    print(f"  {label}: {stats_str(delays)}")

print("\n=== TWEET-TO-GENERATION DELAY BY PERIOD ===")
for label, start, end in periods:
    delays = [r["tweet_to_gen_h"] for r in records
              if r["generated_at"] and start <= r["generated_at"].isoformat() < end
              and r["tweet_to_gen_h"] is not None]
    print(f"  {label}: {stats_str(delays)}")

# === DELAY vs APPROVAL RATE ===
# Bucket by tweet_to_sub delay and check H/(H+UH)
print("\n=== TWEET-TO-SUBMISSION DELAY vs APPROVAL RATE ===")
delay_buckets = [
    ("0-2h", 0, 2),
    ("2-6h", 2, 6),
    ("6-12h", 6, 12),
    ("12-24h", 12, 24),
    ("24-48h", 24, 48),
    ("48h+", 48, 9999),
]

print(f"{'Bucket':>10} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10} {'Resolved%':>10}")
for label, lo, hi in delay_buckets:
    h = uh = nmr = 0
    for r in records:
        d = r["tweet_to_sub_h"]
        if d is None: continue
        if lo <= d < hi:
            if r["status"] == "helpful": h += 1
            elif r["status"] == "unhelpful": uh += 1
            else: nmr += 1
    total = h + uh + nmr
    if total == 0: continue
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{label:>10} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10} {resolved:>10}")

# Same but only for post-candidate-system (Mar 4+)
print("\n=== TWEET-TO-SUBMISSION DELAY vs APPROVAL (Mar 4+ only) ===")
print(f"{'Bucket':>10} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10} {'Resolved%':>10}")
for label, lo, hi in delay_buckets:
    h = uh = nmr = 0
    for r in records:
        d = r["tweet_to_sub_h"]
        if d is None: continue
        if not r["submitted_at"] or r["submitted_at"].isoformat() < "2026-03-04": continue
        if lo <= d < hi:
            if r["status"] == "helpful": h += 1
            elif r["status"] == "unhelpful": uh += 1
            else: nmr += 1
    total = h + uh + nmr
    if total == 0: continue
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{label:>10} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10} {resolved:>10}")

# === GENERATION-TO-SUBMISSION DELAY vs APPROVAL (Mar 4+ only) ===
print("\n=== GEN-TO-SUBMISSION DELAY vs APPROVAL (Mar 4+ only) ===")
gen_buckets = [
    ("0-1h", 0, 1),
    ("1-3h", 1, 3),
    ("3-6h", 3, 6),
    ("6-12h", 6, 12),
    ("12-24h", 12, 24),
    ("24h+", 24, 9999),
]
print(f"{'Bucket':>10} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10} {'Resolved%':>10}")
for label, lo, hi in gen_buckets:
    h = uh = nmr = 0
    for r in records:
        d = r["gen_to_sub_h"]
        if d is None: continue
        if not r["submitted_at"] or r["submitted_at"].isoformat() < "2026-03-04": continue
        if lo <= d < hi:
            if r["status"] == "helpful": h += 1
            elif r["status"] == "unhelpful": uh += 1
            else: nmr += 1
    total = h + uh + nmr
    if total == 0: continue
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{label:>10} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10} {resolved:>10}")
