"""
For Scheme C, n=1 filter (noteNotNeeded >= 0.8):
list tweets that the filter still gets wrong:
  - noteworthy "incorrect" (proposed but AI judge said wrong)
  - non-noteworthy "incorrect" (false positive: filter still let it through)
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2].parent / "dataset_runs" / "videos-2026-04-16-1102"
THRESHOLD = 0.8
KEY = "noteNotNeeded"


def passes(entry: dict) -> bool:
    scores = (entry.get("logs") or {}).get("scores")
    if not scores:
        return False
    return float(scores[KEY]["score"]) >= THRESHOLD


def show(label: str, entries: list[dict]) -> None:
    print(f"\n=========================== {label} ({len(entries)}) ===========================")
    for i, e in enumerate(entries, 1):
        score = (e.get("logs") or {}).get("scores", {}).get(KEY, {}).get("score")
        print(f"\n--- {i}. {e['url']}  ({KEY}={score}) ---")
        print(f"TWEET: {(e.get('text') or '').strip()}")
        gt = (e.get("ground_truth_note") or "").strip()
        if gt:
            print(f"GROUND TRUTH NOTE: {gt}")
        print(f"PROPOSED NOTE: {(e.get('note_text') or '').strip()}")


def main() -> None:
    nw_inc = json.loads((DATA_DIR / "note_worthy_incorrect.json").read_text())
    nnw_inc = json.loads((DATA_DIR / "non_note_worthy_incorrect.json").read_text())

    nw_kept = [e for e in nw_inc if passes(e)]
    nnw_kept = [e for e in nnw_inc if passes(e)]

    show("NOTEWORTHY-INCORRECT (proposed but wrong, still passes filter)", nw_kept)
    show("NON-NOTEWORTHY FALSE POSITIVES (still passes filter)", nnw_kept)


if __name__ == "__main__":
    main()
