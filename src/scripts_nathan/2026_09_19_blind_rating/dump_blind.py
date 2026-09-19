# /// script
# requires-python = ">=3.10"
# ///
"""Prints a range of the sample with the outcome stripped, so Claude rates blind."""
import json, sys
from pathlib import Path
lo, hi = int(sys.argv[1]), int(sys.argv[2])
rows = json.loads((Path(__file__).parent / "data" / "sample.json").read_text())
for r in rows[lo:hi]:
    c = r["context"]
    ctx = f"{c['age_hours']}h old, {c['impressions_at_sight']} imps, {c['velocity_per_hour']}/h, {c['feed_tier']}, {c['author_followers']} followers, media={c['media']}, requests={c['note_requests']}, eval={c['eval_score']}"
    print(f"--- [{r['idx']}] {r['note_id']}")
    print(f"CTX  {ctx}")
    print(f"POST {(r['tweet_text'] or '')[:420]}")
    print(f"NOTE {r['note_text'][:340]}")
    print(f"SRC  {len(r['sources'])}: {' '.join(s[:70] for s in r['sources'][:3])}")
