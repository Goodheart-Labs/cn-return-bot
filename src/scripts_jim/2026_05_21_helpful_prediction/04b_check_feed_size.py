"""Debug: how is feed_size actually recorded?"""
import os
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# Most recent 1000 runs that have a note_id, see what feed_size looks like
rows = sb.table("pipeline_runs").select("note_id, ab_test_picks, created_at").not_.is_("note_id", "null").order("created_at", desc=True).limit(1000).execute().data
print(f"Got {len(rows)} runs")

vals = Counter()
for r in rows:
    fs = (r.get("ab_test_picks") or {}).get("feed_size", "<missing>")
    vals[fs] += 1
print("feed_size distribution in last 1000 submitted runs:")
for v, c in vals.most_common():
    print(f"  {v}: {c}")

# Also: when does the first 'small' show up? Earliest and latest by feed_size
print("\nEarliest + latest created_at by feed_size:")
by_fs = {}
for r in rows:
    fs = (r.get("ab_test_picks") or {}).get("feed_size")
    if not fs:
        continue
    by_fs.setdefault(fs, []).append(r["created_at"])
for fs, ts in by_fs.items():
    ts.sort()
    print(f"  {fs:>8}: n={len(ts)}  first={ts[0]}  last={ts[-1]}")
