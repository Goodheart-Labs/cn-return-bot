"""
Check when citations actually broke by looking at:
1. note_text in pipeline_runs - do notes contain URLs?
2. source_verification scores over time
3. check_reasoning content for clues
"""
import os, re
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

URL_RE = re.compile(r'https?://\S+')

# 1. Note text from submitted pipeline runs - check for URLs
print("Fetching submitted runs with note_text...")
runs = fetch_all("pipeline_runs",
    "id, bot_id, created_at, note_text, outcome",
    [("outcome", "eq", "submitted")])
print(f"  {len(runs)} runs")

configs = fetch_all("bot_configs", "id, name")
config_map = {c["id"]: c["name"] for c in configs}

# Daily: notes with URLs vs without
print("\n=== DAILY: SUBMITTED NOTES WITH URLs IN TEXT ===")
day_url = defaultdict(lambda: {"has_url": 0, "no_url": 0})
for r in runs:
    dt = r.get("created_at", "")[:10]
    if not dt: continue
    text = r.get("note_text") or ""
    if URL_RE.search(text):
        day_url[dt]["has_url"] += 1
    else:
        day_url[dt]["no_url"] += 1

print(f"{'Date':>12} {'HasURL':>7} {'NoURL':>6} {'%HasURL':>8}")
for d in sorted(day_url.keys()):
    if d < "2026-01-20": continue  # skip early sparse data
    data = day_url[d]
    total = data["has_url"] + data["no_url"]
    pct = f"{data['has_url']/total*100:.0f}%" if total else "N/A"
    print(f"{d:>12} {data['has_url']:>7} {data['no_url']:>6} {pct:>8}")

# 2. Source verification scores over time
print("\n=== SOURCE VERIFICATION SCORES BY WEEK ===")
scores = fetch_all("pipeline_scores", "pipeline_run_id, score_type, score_value, score_label",
    [("score_type", "eq", "source_verification")])
print(f"  {len(scores)} source_verification scores")

run_map = {r["id"]: r for r in runs}

# Also fetch all runs (not just submitted) for score context
all_runs = fetch_all("pipeline_runs", "id, created_at, outcome")
all_run_map = {r["id"]: r for r in all_runs}

week_sv = defaultdict(lambda: {"pass": 0, "fail": 0})
for s in scores:
    run = all_run_map.get(s.get("pipeline_run_id"))
    if not run: continue
    w = (r.get("created_at") or "")[:10]
    dt = run.get("created_at", "")
    if not dt: continue
    dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    val = s.get("score_value")
    label = s.get("score_label") or ""
    if val == 1 or "pass" in label.lower() or "yes" in label.lower():
        week_sv[w]["pass"] += 1
    else:
        week_sv[w]["fail"] += 1

print(f"{'Week':>12} {'Pass':>6} {'Fail':>6} {'%Pass':>7}")
for w in sorted(week_sv.keys()):
    d = week_sv[w]
    total = d["pass"] + d["fail"]
    pct = f"{d['pass']/total*100:.0f}%" if total else "N/A"
    print(f"{w:>12} {d['pass']:>6} {d['fail']:>6} {pct:>7}")

# 3. Check a few note texts around the transition to see citation content
print("\n=== SAMPLE NOTE TEXTS (around breakage period) ===")
# Find notes from late Feb that lack URLs
for r in sorted(runs, key=lambda x: x.get("created_at", "")):
    dt = r.get("created_at", "")[:10]
    text = r.get("note_text") or ""
    bot = config_map.get(r.get("bot_id"), "unknown")
    if "2026-02-15" <= dt <= "2026-02-20":
        has_url = "YES" if URL_RE.search(text) else "NO"
        print(f"  [{dt}] {bot} URL={has_url}: {text[:120]}...")
        if not URL_RE.search(text):
            break  # just show one example

# And one from early Feb that has URLs
for r in sorted(runs, key=lambda x: x.get("created_at", "")):
    dt = r.get("created_at", "")[:10]
    text = r.get("note_text") or ""
    bot = config_map.get(r.get("bot_id"), "unknown")
    if "2026-02-01" <= dt <= "2026-02-05" and URL_RE.search(text):
        print(f"  [{dt}] {bot} URL=YES: {text[:120]}...")
        break

# And one from early March
for r in sorted(runs, key=lambda x: x.get("created_at", "")):
    dt = r.get("created_at", "")[:10]
    text = r.get("note_text") or ""
    bot = config_map.get(r.get("bot_id"), "unknown")
    if "2026-03-01" <= dt <= "2026-03-05" and URL_RE.search(text):
        print(f"  [{dt}] {bot} URL=YES: {text[:120]}...")
        break
    if "2026-03-01" <= dt <= "2026-03-05" and not URL_RE.search(text):
        print(f"  [{dt}] {bot} URL=NO:  {text[:120]}...")
        break
