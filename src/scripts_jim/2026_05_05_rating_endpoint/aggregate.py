"""
Phase 0 aggregation: read raw_notes.jsonl, characterize:
  - has_access coverage
  - rating_counts_per_model: how many models per note? what model names?
  - factor bucket presence
  - tag-count shape (single object vs array)
  - sample row of each unusual shape

Run from repo root:  uv run src/scripts_jim/2026_05_05_rating_endpoint/aggregate.py
"""

import json
from collections import Counter
from pathlib import Path

IN_FILE = Path(__file__).resolve().parent / "raw_notes.jsonl"


def main() -> None:
    notes = [json.loads(line) for line in IN_FILE.open() if line.strip()]
    n = len(notes)
    print(f"Total notes: {n}\n")

    has_access_counts = Counter()
    has_rcpm = 0
    model_counts_per_note = Counter()
    model_names = Counter()
    bucket_presence: Counter = Counter()
    helpful_tag_shape: Counter = Counter()
    not_helpful_tag_shape: Counter = Counter()
    sample_with_access = None
    sample_without_access = None

    for note in notes:
        ss = note.get("scoring_status") or {}
        ha = ss.get("has_access")
        has_access_counts[ha] += 1

        if ha is True and sample_with_access is None:
            sample_with_access = note
        if ha is False and sample_without_access is None:
            sample_without_access = note

        rcpm = ss.get("rating_counts_per_model")
        if rcpm:
            has_rcpm += 1

            if isinstance(rcpm, dict):
                model_counts_per_note[len(rcpm)] += 1
                for name, model_data in rcpm.items():
                    model_names[name] += 1
                    for bucket_key in ("negative_factor_bucket_counts", "neutral_factor_bucket_counts", "positive_factor_bucket_counts"):
                        bucket = (model_data or {}).get(bucket_key)
                        if bucket is None:
                            bucket_presence[f"{bucket_key}=missing"] += 1
                            continue
                        bucket_presence[f"{bucket_key}=present"] += 1
                        h = bucket.get("helpful_tag_counts")
                        nh = bucket.get("not_helpful_tag_counts")
                        helpful_tag_shape[type(h).__name__] += 1
                        not_helpful_tag_shape[type(nh).__name__] += 1
            elif isinstance(rcpm, list):
                model_counts_per_note[len(rcpm)] += 1
                for entry in rcpm:
                    name = entry.get("model_name") if isinstance(entry, dict) else None
                    if name:
                        model_names[name] += 1

    print("== has_access ==")
    for k, v in has_access_counts.items():
        print(f"  {k!r}: {v} ({100*v/n:.1f}%)")

    print(f"\n== rating_counts_per_model present: {has_rcpm} ({100*has_rcpm/n:.1f}%) ==")
    print(f"  type seen: {Counter(type(note.get('scoring_status', {}).get('rating_counts_per_model')).__name__ for note in notes if note.get('scoring_status'))}")

    print("\n== Model count distribution per note ==")
    for k, v in sorted(model_counts_per_note.items()):
        print(f"  {k} model(s): {v}")

    print("\n== Model names seen ==")
    for name, count in model_names.most_common():
        print(f"  {name}: {count}")

    print("\n== Bucket presence ==")
    for k, v in bucket_presence.most_common():
        print(f"  {k}: {v}")

    print("\n== helpful_tag_counts type ==")
    for k, v in helpful_tag_shape.items():
        print(f"  {k}: {v}")
    print("== not_helpful_tag_counts type ==")
    for k, v in not_helpful_tag_shape.items():
        print(f"  {k}: {v}")

    print("\n== Sample note WITH access ==")
    if sample_with_access is not None:
        print(json.dumps(sample_with_access, indent=2)[:3000])
    else:
        print("(none)")

    print("\n== Sample note WITHOUT access ==")
    if sample_without_access is not None:
        print(json.dumps(sample_without_access, indent=2)[:1500])
    else:
        print("(none)")


if __name__ == "__main__":
    main()
