"""Propagate corrected annotation fields for one or more tweet_ids into the
derived big_eval files (dataset.jsonl, splits/val.jsonl, splits/val.csv) WITHOUT
re-running the seeded assembler (which would reshuffle split membership). Also
patches the iter-07 run CSV so a re-judge reflects the new guidance.

Usage: uv run .../sync_valset_row.py <tweet_id> [tweet_id ...]
"""
import csv
import json
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)

BIG_EVAL = Path(__file__).resolve().parents[3] / "datasets" / "big_eval"
ANN_DIR = BIG_EVAL / "annotations"
DATASET = BIG_EVAL / "dataset.jsonl"
VAL_JSONL = BIG_EVAL / "splits" / "val.jsonl"
VAL_CSV = BIG_EVAL / "splits" / "val.csv"
RUN_CSV = (Path(__file__).resolve().parents[3] / "dataset_runs"
           / "tryout-iter-07-judge-temp0-2026-05-28-2250"
           / "results_iter-07-judge-temp0.csv")

JSONL_FIELDS = ["needs_note", "role", "no_note_reason", "tweet_summary",
                "why_note_decision", "judge_guidance", "reference_note"]

tids = sys.argv[1:]
if not tids:
    sys.exit("give at least one tweet_id")
anns = {t: json.loads((ANN_DIR / f"{t}.json").read_text()) for t in tids}


def patch_jsonl(path: Path) -> int:
    lines = path.read_text().splitlines()
    n = 0
    for i, ln in enumerate(lines):
        if not ln.strip():
            continue
        rec = json.loads(ln)
        tid = str(rec.get("tweet_id"))
        if tid in anns:
            for f in JSONL_FIELDS:
                rec[f] = anns[tid].get(f, "")
            lines[i] = json.dumps(rec)
            n += 1
    path.write_text("\n".join(lines) + "\n")
    return n


def patch_csv(path: Path, full_cols: bool) -> int:
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        rows = list(reader)
    n = 0
    for r in rows:
        tid = (r.get("url", "")).rsplit("/", 1)[-1]
        if tid in anns:
            a = anns[tid]
            r["needs_note"] = a.get("needs_note", "")
            r["ground_truth_note"] = a.get("reference_note", "")
            r["judge_guidance"] = a.get("judge_guidance", "")
            if full_cols and "tags" in cols:
                tags = list(a.get("categories") or [])
                if a.get("no_note_reason"):
                    tags.append(f"no_note_reason:{a['no_note_reason']}")
                r["tags"] = "|".join(tags)
            n += 1
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    return n


print(f"tids: {tids}")
print(f"dataset.jsonl: {patch_jsonl(DATASET)} rows")
print(f"val.jsonl:     {patch_jsonl(VAL_JSONL)} rows")
print(f"val.csv:       {patch_csv(VAL_CSV, full_cols=True)} rows")
if RUN_CSV.exists():
    print(f"run CSV:       {patch_csv(RUN_CSV, full_cols=False)} rows")
