# /// script
# requires-python = ">=3.10"
# ///
"""Posts Claude's ratings for a batch of sample indexes. Reads 'idx:pct' pairs."""
import json, sys, urllib.request
from pathlib import Path
rows = json.loads((Path(__file__).parent / "data" / "sample.json").read_text())
by_idx = {r["idx"]: r for r in rows}
pairs = [p.split(":") for p in sys.argv[1].split(",")]
n = 0
for idx, pct in pairs:
    r = by_idx[int(idx)]
    body = json.dumps({"rater": "claude", "note_id": r["note_id"], "p_helpful": int(pct),
                       "comment": None, "seconds": 0}).encode()
    req = urllib.request.Request("http://127.0.0.1:8012/api/rate", data=body,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        n = json.loads(resp.read())["count"]
print("claude ratings saved:", n)
