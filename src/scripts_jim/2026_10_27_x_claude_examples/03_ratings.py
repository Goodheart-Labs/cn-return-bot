# /// script
# dependencies = ["requests", "python-dotenv", "supabase"]
# ///
"""Step 3 of the X Claude examples (GOO-527, GOO-614): count the ratings of the
100 chosen notes.

It streams every ratings partition of the public dump, about 40 GB in all, one
at a time, and deletes each after scanning it. For each note it counts the
Helpful, Somewhat helpful and Not helpful ratings and how often raters picked
each reason.

  uv run src/scripts_jim/2026_10_27_x_claude_examples/03_ratings.py
"""

import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent

_spec = importlib.util.spec_from_file_location("fill_ratings", PROJECT_ROOT / "src" / "production" / "fill_ratings.py")
fr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fr)
fr.CN_DATA_DIR = PROJECT_ROOT / "src" / "scripts_jim" / "cn_data"

OUT_PATH = HERE / "ratings.json"


def main() -> None:
    examples = [json.loads(line) for line in (HERE / "examples.jsonl").read_text().splitlines() if line]
    aggregates = fr.aggregate_ratings({e["note_id"] for e in examples}, stream=True)
    ratings = {
        note_id: {
            "helpful": agg["helpful_count"],
            "somewhat_helpful": agg["somewhat_helpful_count"],
            "not_helpful": agg["not_helpful_count"],
            "helpful_reasons": fr.prune_zero_tags(dict(agg["helpful_tag_counts"])),
            "not_helpful_reasons": fr.prune_zero_tags(dict(agg["not_helpful_tag_counts"])),
        }
        for note_id, agg in aggregates.items()
    }
    OUT_PATH.write_text(json.dumps(ratings, indent=1))
    print(f"[out] ratings for {len(ratings)} of {len(examples)} notes -> {OUT_PATH}")


if __name__ == "__main__":
    main()
