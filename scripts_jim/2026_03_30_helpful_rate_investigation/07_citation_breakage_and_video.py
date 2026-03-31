"""
1. When did citations actually break? Look at pipeline_runs for empty source_url patterns.
2. opus-main vs opus-main-v2 on video vs non-video tweets.
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

# 1. Check source_url presence on submitted pipeline runs over time
print("Fetching submitted pipeline runs with source info...")
submitted_runs = fetch_all("pipeline_runs",
    "id, bot_id, created_at, note_id, source_url, has_video, has_photo, outcome",
    [("outcome", "eq", "submitted")])
print(f"  {len(submitted_runs)} submitted runs")

# Bot configs
configs = fetch_all("bot_configs", "id, name")
config_map = {c["id"]: c["name"] for c in configs}

# Canonical for status
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status")
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

def week_of(dt_str):
    if not dt_str: return None
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")

# === CITATION BREAKAGE TIMELINE ===
print("\n=== SOURCE URL PRESENCE BY WEEK (submitted notes) ===")
week_source = defaultdict(lambda: {"has_source": 0, "no_source": 0, "total": 0})
for r in submitted_runs:
    w = week_of(r.get("created_at"))
    if not w: continue
    week_source[w]["total"] += 1
    if r.get("source_url") and r["source_url"].strip():
        week_source[w]["has_source"] += 1
    else:
        week_source[w]["no_source"] += 1

print(f"{'Week':>12} {'Total':>6} {'HasSrc':>7} {'NoSrc':>6} {'%HasSrc':>8}")
for w in sorted(week_source.keys()):
    d = week_source[w]
    pct = f"{d['has_source']/d['total']*100:.0f}%" if d['total'] else "N/A"
    print(f"{w:>12} {d['total']:>6} {d['has_source']:>7} {d['no_source']:>6} {pct:>8}")

# === SOURCE URL BY BOT (to see which bots use citations) ===
print("\n=== SOURCE URL PRESENCE BY BOT (all submitted) ===")
bot_source = defaultdict(lambda: {"has": 0, "no": 0})
for r in submitted_runs:
    bot = config_map.get(r.get("bot_id"), "unknown")
    if r.get("source_url") and r["source_url"].strip():
        bot_source[bot]["has"] += 1
    else:
        bot_source[bot]["no"] += 1

print(f"{'Bot':>30} {'HasSrc':>7} {'NoSrc':>6} {'%HasSrc':>8}")
for bot in sorted(bot_source.keys()):
    d = bot_source[bot]
    total = d["has"] + d["no"]
    pct = f"{d['has']/total*100:.0f}%" if total else "N/A"
    print(f"{bot:>30} {d['has']:>7} {d['no']:>6} {pct:>8}")

# === DAILY source_url for fine-grained breakage detection ===
print("\n=== DAILY SOURCE URL (to pinpoint breakage date) ===")
day_source = defaultdict(lambda: {"has": 0, "no": 0})
for r in submitted_runs:
    dt = r.get("created_at", "")[:10]
    if not dt: continue
    if r.get("source_url") and r["source_url"].strip():
        day_source[dt]["has"] += 1
    else:
        day_source[dt]["no"] += 1

# Only show days with activity, focus on transition period
print(f"{'Date':>12} {'HasSrc':>7} {'NoSrc':>6} {'%HasSrc':>8}")
for d in sorted(day_source.keys()):
    data = day_source[d]
    total = data["has"] + data["no"]
    pct = f"{data['has']/total*100:.0f}%" if total else "N/A"
    if d >= "2026-02-01":  # focus on the relevant period
        print(f"{d:>12} {data['has']:>7} {data['no']:>6} {pct:>8}")

# === VIDEO vs NON-VIDEO: opus-main vs opus-main-v2 ===
print("\n=== OPUS-MAIN vs OPUS-MAIN-V2: VIDEO vs NON-VIDEO TWEETS ===")
# Use notes table for bot_name, join with pipeline_runs for has_video
notes = fetch_all("notes", "note_id, bot_name, submitted_at")
note_bot_map = {n["note_id"]: n["bot_name"] for n in notes}

# Build run -> video mapping
run_video = {}
for r in submitted_runs:
    nid = r.get("note_id")
    if nid:
        run_video[nid] = {
            "has_video": r.get("has_video", False),
            "has_photo": r.get("has_photo", False),
            "bot_from_run": config_map.get(r.get("bot_id"), "unknown")
        }

combos = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
for n in notes:
    bot = n.get("bot_name", "")
    if bot not in ("opus-main", "opus-main-v2"): continue
    nid = n.get("note_id")
    rv = run_video.get(nid, {})
    has_video = rv.get("has_video", False)
    media_type = "video" if has_video else "non-video"
    key = f"{bot} / {media_type}"
    s = classify(nid)
    combos[key][s] += 1

print(f"{'Combo':>35} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10} {'Resolved%':>10}")
for key in sorted(combos.keys()):
    d = combos[key]
    h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
    total = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"{key:>35} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10} {resolved:>10}")

# Same but split by pre/post Mar 16 (when both fixes landed)
print("\n=== OPUS-MAIN vs OPUS-MAIN-V2: PRE vs POST Mar 16 fix ===")
combos2 = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
for n in notes:
    bot = n.get("bot_name", "")
    if bot not in ("opus-main", "opus-main-v2"): continue
    nid = n.get("note_id")
    dt = n.get("submitted_at", "")
    period = "post-fix" if dt >= "2026-03-16" else "pre-fix"
    rv = run_video.get(nid, {})
    has_video = rv.get("has_video", False)
    media_type = "video" if has_video else "non-video"
    key = f"{bot} / {media_type} / {period}"
    s = classify(nid)
    combos2[key][s] += 1

print(f"{'Combo':>50} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10}")
for key in sorted(combos2.keys()):
    d = combos2[key]
    h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
    total = h + uh + nmr
    if total == 0: continue
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    print(f"{key:>50} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10}")

# === ALL BOTS: pre vs post Mar 16 fix ===
print("\n=== ALL BOTS: PRE vs POST Mar 16 (citation + media fix) ===")
period_data = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0})
for n in notes:
    bot = n.get("bot_name", "")
    dt = n.get("submitted_at", "")
    period = "post-fix" if dt >= "2026-03-16" else "pre-fix"
    key = f"{bot} / {period}"
    s = classify(n.get("note_id"))
    period_data[key][s] += 1

# Show only bots with data in both periods
bots_seen = set()
for key in period_data:
    bots_seen.add(key.split(" / ")[0])

print(f"{'Bot / Period':>45} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10}")
for bot in sorted(bots_seen):
    for period in ["pre-fix", "post-fix"]:
        key = f"{bot} / {period}"
        d = period_data.get(key, {"helpful": 0, "unhelpful": 0, "nmr": 0})
        h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
        total = h + uh + nmr
        if total == 0: continue
        ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
        print(f"{key:>45} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10}")
