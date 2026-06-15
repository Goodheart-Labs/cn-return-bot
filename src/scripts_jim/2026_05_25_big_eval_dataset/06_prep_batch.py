"""
Phase 6 helper: emit the next batch of un-annotated, cached datapoints for an
annotation subagent. Resumable: only includes tweets that HAVE a cached input and
do NOT yet have an annotation.

  uv run .../06_prep_batch.py [--size N] [--id LABEL]   # one batch
  uv run .../06_prep_batch.py --count K [--size N]      # K non-overlapping batches (parallel subagents)
  uv run .../06_prep_batch.py --status                  # print progress, emit nothing

Writes _cache/batch_<id>.json (arrays the subagents read) and prints paths +
tweet_ids + overall progress.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIG_EVAL = HERE.parent.parent.parent / "datasets" / "big_eval"
SELECTED = BIG_EVAL / "selected.jsonl"
INPUTS = BIG_EVAL / "inputs"
ANNOT = BIG_EVAL / "annotations"
CACHE = BIG_EVAL / "_cache"

CARRY_FIELDS = ["note_text", "current_status", "role", "needs_note", "categories",
                "not_helpful_tag_counts", "dominant_not_helpful_reason", "selection_bucket",
                "showcase_hint", "rating_volume", "impressions", "source"]


def load_selected():
    return [json.loads(ln) for ln in SELECTED.open()]


def status(rows):
    cached = annotated = ready = 0
    for r in rows:
        tid = str(r["tweet_id"])
        has_in = (INPUTS / f"{tid}.json").exists()
        has_an = (ANNOT / f"{tid}.json").exists()
        cached += has_in
        annotated += has_an
        ready += has_in and not has_an
    print(f"selected={len(rows)} cached={cached} annotated={annotated} ready(cached,unannotated)={ready}")
    return ready


def main():
    args = sys.argv[1:]
    rows = load_selected()
    if "--status" in args:
        status(rows)
        return
    size = int(args[args.index("--size") + 1]) if "--size" in args else 10
    count = int(args[args.index("--count") + 1]) if "--count" in args else 1
    label = args[args.index("--id") + 1] if "--id" in args else None

    ANNOT.mkdir(parents=True, exist_ok=True)
    ready = [r for r in rows
             if (INPUTS / f"{str(r['tweet_id'])}.json").exists()
             and not (ANNOT / f"{str(r['tweet_id'])}.json").exists()]

    def make_entry(r):
        tid = str(r["tweet_id"])
        e = {"tweet_id": tid, "input_path": f"datasets/big_eval/inputs/{tid}.json"}
        for k in CARRY_FIELDS:
            if k in r:
                e[k] = r[k]
        return e

    CACHE.mkdir(parents=True, exist_ok=True)
    pos = 0
    for b in range(count):
        chunk = ready[pos:pos + size]
        pos += size
        if not chunk:
            break
        bid = label if (count == 1 and label) else str(b)
        out = CACHE / f"batch_{bid}.json"
        out.write_text(json.dumps([make_entry(r) for r in chunk], indent=2))
        print(f"batch_{bid}: {len(chunk)} -> {out}")
    status(rows)


if __name__ == "__main__":
    main()
