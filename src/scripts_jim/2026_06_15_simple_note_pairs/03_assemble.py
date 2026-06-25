"""Merge the subagent verdicts (batches/*.out.json) back onto the full pairs and
write the three deliverable JSON files.

Validates strictly: every pair in pairs.json must be classified exactly once
with a valid category. Reports anything missing / duplicated / invalid instead
of silently dropping it.

Outputs (in this folder):
  classified.json            all pairs + {category, reason}
  similar.json
  other_simpler.json         <- the "simple and nice" target set
  other_better_content.json

Run: uv run src/scripts_jim/2026_06_15_simple_note_pairs/03_assemble.py
"""

import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
BATCH_DIR = HERE / "batches"
CATEGORIES = ["similar", "other_simpler", "other_better_content"]


def main():
    pairs = json.loads((HERE / "pairs.json").read_text())
    by_id = {p["our_note_id"]: p for p in pairs}

    verdict = {}
    dupes, invalid, unknown_id = [], [], []
    for out_file in sorted(BATCH_DIR.glob("batch_*.out.json")):
        rows = json.loads(out_file.read_text())
        for r in rows:
            nid = r.get("our_note_id")
            cat = r.get("category")
            if nid not in by_id:
                unknown_id.append((out_file.name, nid))
                continue
            if cat not in CATEGORIES:
                invalid.append((nid, cat))
                continue
            if nid in verdict:
                dupes.append(nid)
                continue
            verdict[nid] = {"category": cat, "reason": r.get("reason", "")}

    missing = [nid for nid in by_id if nid not in verdict]

    print(f"pairs: {len(pairs)}  classified: {len(verdict)}")
    if missing:
        print(f"  MISSING ({len(missing)}): {missing[:10]}{' ...' if len(missing) > 10 else ''}")
    if dupes:
        print(f"  DUPLICATE verdicts ({len(dupes)}): {dupes[:10]}")
    if invalid:
        print(f"  INVALID categories ({len(invalid)}): {invalid[:10]}")
    if unknown_id:
        print(f"  UNKNOWN ids ({len(unknown_id)}): {unknown_id[:10]}")

    results = []
    for p in pairs:
        v = verdict.get(p["our_note_id"])
        if not v:
            continue
        results.append({**p, "category": v["category"], "reason": v["reason"]})

    (HERE / "classified.json").write_text(json.dumps(results, indent=1))
    print("\nCategory counts:", dict(Counter(r["category"] for r in results)))
    for cat in CATEGORIES:
        rows = [r for r in results if r["category"] == cat]
        (HERE / f"{cat}.json").write_text(json.dumps(rows, indent=1))
        print(f"  wrote {len(rows):4d} -> {cat}.json")

    if missing:
        (HERE / "missing_ids.json").write_text(json.dumps(missing, indent=1))
        print(f"\n  {len(missing)} pairs unclassified -> missing_ids.json (re-dispatch these)")


if __name__ == "__main__":
    main()
