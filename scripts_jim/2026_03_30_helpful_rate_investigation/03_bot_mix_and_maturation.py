"""
Test two hypotheses:
1. Bot-mix effect: new bots (created ~Feb 14) perform worse than opus-main
2. Maturation bias: recent notes haven't had time to get rated, distorting the ratio

Also check opus-main specifically - did IT get worse, or is it just diluted by new bots?
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

def fetch_all(table, select):
    rows, offset = [], 0
    while True:
        resp = sb.table(table).select(select).range(offset, offset + 999).execute()
        rows.extend(resp.data)
        if len(resp.data) < 1000: break
        offset += 1000
    return rows

notes = fetch_all("notes", "note_id, bot_name, submitted_at, evaluation_score")
canonical = fetch_all("canonical_note_information",
    "note_id, first_seen_at, cn_status, locked_status, first_non_nmr_status, "
    "most_recent_non_nmr_status, first_non_nmr_at")
canon_map = {n["note_id"]: n for n in canonical}

def status_of(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

# 1. OPUS-MAIN ONLY: weekly performance
print("=== OPUS-MAIN PERFORMANCE OVER TIME ===")
opus_main_weeks = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
for n in notes:
    if n.get("bot_name") != "opus-main": continue
    dt = n.get("submitted_at")
    if not dt: continue
    dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    w = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
    s = status_of(n.get("note_id"))
    opus_main_weeks[w][s] += 1

print(f"{'Week':>12} {'H':>4} {'UH':>4} {'NMR':>5} {'H/(H+UH)':>10} {'Resolved%':>10}")
for w in sorted(opus_main_weeks.keys()):
    d = opus_main_weeks[w]
    h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
    total = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{w:>12} {h:>4} {uh:>4} {nmr:>5} {ratio:>10} {resolved:>10}")

# 2. ALL BOTS: lifetime performance (only notes old enough to have resolved)
print("\n=== BOT LIFETIME PERFORMANCE (notes submitted before Mar 1 for maturation) ===")
bot_perf = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
cutoff = "2026-03-01"
for n in notes:
    dt = n.get("submitted_at", "")
    if dt > cutoff: continue
    bot = n.get("bot_name") or "unknown"
    s = status_of(n.get("note_id"))
    bot_perf[bot][s] += 1

print(f"{'Bot':>30} {'H':>4} {'UH':>4} {'NMR':>5} {'Total':>6} {'H/(H+UH)':>10} {'Resolved%':>10}")
for bot in sorted(bot_perf.keys(), key=lambda b: -(bot_perf[b]["helpful"]+bot_perf[b]["unhelpful"])):
    d = bot_perf[bot]
    h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
    total = h + uh + nmr
    if total < 3: continue
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{bot:>30} {h:>4} {uh:>4} {nmr:>5} {total:>6} {ratio:>10} {resolved:>10}")

# 3. Maturation check: time from first_seen to first_non_nmr
print("\n=== MATURATION: DAYS TO FIRST NON-NMR STATUS ===")
durations = []
for n in notes:
    nid = n.get("note_id")
    c = canon_map.get(nid, {})
    seen = c.get("first_seen_at")
    resolved = c.get("first_non_nmr_at")
    if not seen or not resolved: continue
    seen_dt = datetime.fromisoformat(seen.replace("Z", "+00:00"))
    resolved_dt = datetime.fromisoformat(resolved.replace("Z", "+00:00"))
    days = (resolved_dt - seen_dt).total_seconds() / 86400
    durations.append((n.get("submitted_at", "")[:10], days))

if durations:
    durations.sort(key=lambda x: x[1])
    vals = [d[1] for d in durations]
    print(f"  n={len(vals)}, median={vals[len(vals)//2]:.1f}d, p75={vals[int(len(vals)*0.75)]:.1f}d, p90={vals[int(len(vals)*0.9)]:.1f}d, max={vals[-1]:.1f}d")

    # By submission month
    monthly = defaultdict(list)
    for sub, days in durations:
        monthly[sub[:7]].append(days)
    print("\n  By month:")
    for m in sorted(monthly.keys()):
        v = sorted(monthly[m])
        print(f"    {m}: n={len(v)}, median={v[len(v)//2]:.1f}d, p75={v[int(len(v)*0.75)]:.1f}d")

# 4. Volume share by bot over time
print("\n=== SUBMISSION VOLUME SHARE BY BOT (weekly) ===")
vol_week = defaultdict(lambda: defaultdict(int))
for n in notes:
    dt = n.get("submitted_at")
    if not dt: continue
    dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    vol_week[w][n.get("bot_name") or "unknown"] += 1

all_bots = set()
for w in vol_week:
    all_bots.update(vol_week[w].keys())
top_bots = sorted(all_bots)

print(f"{'Week':>12}", end="")
for b in top_bots:
    print(f" {b[:12]:>12}", end="")
print(f" {'TOTAL':>6}")

for w in sorted(vol_week.keys()):
    total = sum(vol_week[w].values())
    print(f"{w:>12}", end="")
    for b in top_bots:
        v = vol_week[w].get(b, 0)
        print(f" {v:>12}", end="")
    print(f" {total:>6}")

# 5. Canonical notes NOT in notes table - are there old notes performing differently?
print("\n=== CANONICAL NOTES NOT IN NOTES TABLE ===")
note_ids_in_notes = {n["note_id"] for n in notes if n.get("note_id")}
orphan_weeks = defaultdict(lambda: {"h": 0, "uh": 0, "nmr": 0, "total": 0})
for c in canonical:
    if c["note_id"] in note_ids_in_notes: continue
    dt = c.get("first_seen_at")
    if not dt: continue
    dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    orphan_weeks[w]["total"] += 1
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        orphan_weeks[w]["h"] += 1
    elif "not_helpful" in s.lower():
        orphan_weeks[w]["uh"] += 1
    else:
        orphan_weeks[w]["nmr"] += 1

print(f"{'Week':>12} {'Total':>6} {'H':>4} {'UH':>4} {'NMR':>5} {'H/(H+UH)':>10}")
for w in sorted(orphan_weeks.keys()):
    d = orphan_weeks[w]
    ratio = f"{d['h']/(d['h']+d['uh'])*100:.0f}%" if (d['h']+d['uh']) > 0 else "N/A"
    print(f"{w:>12} {d['total']:>6} {d['h']:>4} {d['uh']:>4} {d['nmr']:>5} {ratio:>10}")
