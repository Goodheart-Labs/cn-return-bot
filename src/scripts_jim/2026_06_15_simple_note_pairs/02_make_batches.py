"""Split pairs.json into batch files, one per Claude Code Sonnet subagent.

Each batch file holds the minimal fields a subagent needs to compare the two
notes. The subagent writes a sibling batch_NN.out.json with one verdict per
pair (keyed by our_note_id). 03_assemble.py merges the verdicts back.

Run: uv run src/scripts_jim/2026_06_15_simple_note_pairs/02_make_batches.py
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BATCH_DIR = HERE / "batches"
BATCH_SIZE = 28


def main():
    pairs = json.loads((HERE / "pairs.json").read_text())
    BATCH_DIR.mkdir(exist_ok=True)
    for f in BATCH_DIR.glob("*.json"):
        f.unlink()

    n_batches = 0
    for start in range(0, len(pairs), BATCH_SIZE):
        chunk = pairs[start : start + BATCH_SIZE]
        slim = [
            {
                "our_note_id": p["our_note_id"],
                "tweet_text": p["tweet_text"],
                "our_note_text": p["our_note_text"],
                "helpful_note_text": p["helpful_note_text"],
            }
            for p in chunk
        ]
        path = BATCH_DIR / f"batch_{n_batches:02d}.json"
        path.write_text(json.dumps(slim, indent=1))
        n_batches += 1

    print(f"Wrote {n_batches} batches of <= {BATCH_SIZE} pairs to {BATCH_DIR.relative_to(HERE.parents[2])}")


if __name__ == "__main__":
    main()
