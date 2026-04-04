"""
Check source_url in canonical_note_information and notes tables.
Also check if the note_text in pipeline_runs is just missing the URL
but the actual submitted note had one.
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

# 1. Check canonical_note_information source_url
print("Fetching canonical source_url...")
canonical = fetch_all("canonical_note_information", "note_id, source_url, first_seen_at, note_text")

day_src = defaultdict(lambda: {"has": 0, "no": 0})
day_url_in_text = defaultdict(lambda: {"has": 0, "no": 0})
for c in canonical:
    dt = (c.get("first_seen_at") or "")[:10]
    if not dt: continue
    if c.get("source_url") and c["source_url"].strip():
        day_src[dt]["has"] += 1
    else:
        day_src[dt]["no"] += 1
    text = c.get("note_text") or ""
    if URL_RE.search(text):
        day_url_in_text[dt]["has"] += 1
    else:
        day_url_in_text[dt]["no"] += 1

print("\n=== CANONICAL: SOURCE_URL FIELD BY WEEK ===")
week_src = defaultdict(lambda: {"has": 0, "no": 0})
for dt, d in day_src.items():
    dt_obj = datetime.fromisoformat(dt)
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    week_src[w]["has"] += d["has"]
    week_src[w]["no"] += d["no"]

print(f"{'Week':>12} {'HasSrc':>7} {'NoSrc':>6} {'%HasSrc':>8}")
for w in sorted(week_src.keys()):
    d = week_src[w]
    total = d["has"] + d["no"]
    pct = f"{d['has']/total*100:.0f}%" if total else "N/A"
    print(f"{w:>12} {d['has']:>7} {d['no']:>6} {pct:>8}")

print("\n=== CANONICAL: URLs IN NOTE_TEXT BY WEEK ===")
week_url = defaultdict(lambda: {"has": 0, "no": 0})
for dt, d in day_url_in_text.items():
    dt_obj = datetime.fromisoformat(dt)
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    week_url[w]["has"] += d["has"]
    week_url[w]["no"] += d["no"]

print(f"{'Week':>12} {'HasURL':>7} {'NoURL':>6} {'%HasURL':>8}")
for w in sorted(week_url.keys()):
    d = week_url[w]
    total = d["has"] + d["no"]
    pct = f"{d['has']/total*100:.0f}%" if total else "N/A"
    print(f"{w:>12} {d['has']:>7} {d['no']:>6} {pct:>8}")

# 2. Notes table source_url
print("\n=== NOTES TABLE: SOURCE_URL BY WEEK ===")
notes = fetch_all("notes", "note_id, source_url, submitted_at, note_text")
week_nsrc = defaultdict(lambda: {"has": 0, "no": 0})
for n in notes:
    dt = (n.get("submitted_at") or "")[:10]
    if not dt: continue
    dt_obj = datetime.fromisoformat(dt)
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    if n.get("source_url") and n["source_url"].strip():
        week_nsrc[w]["has"] += 1
    else:
        week_nsrc[w]["no"] += 1

print(f"{'Week':>12} {'HasSrc':>7} {'NoSrc':>6} {'%HasSrc':>8}")
for w in sorted(week_nsrc.keys()):
    d = week_nsrc[w]
    total = d["has"] + d["no"]
    pct = f"{d['has']/total*100:.0f}%" if total else "N/A"
    print(f"{w:>12} {d['has']:>7} {d['no']:>6} {pct:>8}")

# 3. Sample canonical notes from good period - do they have source URLs?
print("\n=== SAMPLE CANONICAL NOTES (Jan-Feb) ===")
count = 0
for c in sorted(canonical, key=lambda x: x.get("first_seen_at", "")):
    dt = (c.get("first_seen_at") or "")[:10]
    if dt < "2026-01-20" or dt > "2026-02-10": continue
    src = c.get("source_url") or "NONE"
    text = (c.get("note_text") or "")[:150]
    has_url = "URL_IN_TEXT" if URL_RE.search(c.get("note_text") or "") else "NO_URL"
    print(f"  [{dt}] src={src[:60]}... {has_url}")
    print(f"         text: {text}")
    count += 1
    if count >= 5: break

# 4. Sample from broken period
print("\n=== SAMPLE CANONICAL NOTES (late Feb) ===")
count = 0
for c in sorted(canonical, key=lambda x: x.get("first_seen_at", "")):
    dt = (c.get("first_seen_at") or "")[:10]
    if dt < "2026-02-20" or dt > "2026-03-01": continue
    src = c.get("source_url") or "NONE"
    text = (c.get("note_text") or "")[:150]
    has_url = "URL_IN_TEXT" if URL_RE.search(c.get("note_text") or "") else "NO_URL"
    print(f"  [{dt}] src={src[:60]}... {has_url}")
    print(f"         text: {text}")
    count += 1
    if count >= 5: break

# 5. Sample from post-fix period
print("\n=== SAMPLE CANONICAL NOTES (post Mar 16 fix) ===")
count = 0
for c in sorted(canonical, key=lambda x: x.get("first_seen_at", ""), reverse=True):
    dt = (c.get("first_seen_at") or "")[:10]
    if dt < "2026-03-16": continue
    src = c.get("source_url") or "NONE"
    text = (c.get("note_text") or "")[:150]
    has_url = "URL_IN_TEXT" if URL_RE.search(c.get("note_text") or "") else "NO_URL"
    print(f"  [{dt}] src={src[:60]}... {has_url}")
    print(f"         text: {text}")
    count += 1
    if count >= 5: break
