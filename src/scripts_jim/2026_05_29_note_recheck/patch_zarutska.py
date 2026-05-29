"""Surgically patch the Zarutska row (tweet_id 2016313026161299803) in the
derived big_eval files to match the corrected annotation. Does NOT re-run the
assembler (which would reshuffle split membership via the seeded splitter).

Changed annotation-derived fields: needs_note, role, no_note_reason,
tweet_summary, why_note_decision, judge_guidance, reference_note.
"""
import csv
import json
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)

TID = "2016313026161299803"
URL = f"https://x.com/i/status/{TID}"
BIG_EVAL = Path(__file__).resolve().parents[3] / "datasets" / "big_eval"
ANN = BIG_EVAL / "annotations" / f"{TID}.json"
DATASET = BIG_EVAL / "dataset.jsonl"
VAL_JSONL = BIG_EVAL / "splits" / "val.jsonl"
VAL_CSV = BIG_EVAL / "splits" / "val.csv"

ann = json.loads(ANN.read_text())
JSONL_FIELDS = [
    "needs_note", "role", "no_note_reason", "tweet_summary",
    "why_note_decision", "judge_guidance", "reference_note",
]


def patch_jsonl(path: Path) -> bool:
    lines = path.read_text().splitlines()
    hit = False
    for i, ln in enumerate(lines):
        if not ln.strip():
            continue
        rec = json.loads(ln)
        if str(rec.get("tweet_id")) == TID:
            for f in JSONL_FIELDS:
                rec[f] = ann.get(f, "")
            lines[i] = json.dumps(rec)
            hit = True
    path.write_text("\n".join(lines) + "\n")
    return hit


def patch_csv(path: Path) -> bool:
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        rows = list(reader)
    hit = False
    for r in rows:
        if r.get("url") == URL:
            r["needs_note"] = ann.get("needs_note", "")
            r["ground_truth_note"] = ann.get("reference_note", "")
            r["judge_guidance"] = ann.get("judge_guidance", "")
            tags = list(ann.get("categories") or [])
            if ann.get("no_note_reason"):
                tags.append(f"no_note_reason:{ann['no_note_reason']}")
            r["tags"] = "|".join(tags)
            hit = True
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    return hit


print(f"dataset.jsonl patched: {patch_jsonl(DATASET)}")
print(f"val.jsonl patched:     {patch_jsonl(VAL_JSONL)}")
print(f"val.csv patched:       {patch_csv(VAL_CSV)}")
