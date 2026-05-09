"""Pull recent rejected/failed runs for the three broken simple-bot search
variants and dump them to JSONL for downstream scripts to chew on.

The candidate-rate-drop investigation found these three variants reject 60–
70% of notes at the source-verification stage. Hypothesis-set:
  H1: model hallucinates URLs → fetcher returns 404, verifier rejects
  H2: searxng truncates long URLs → model cites the truncated string
  H3: paywalled / robots-blocked sources → fetcher 403/timeout

Output: failed_runs.jsonl in this folder. One row per (variant, run).
"""

import json
import os
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

LOOKBACK_DAYS = 14
MAX_PER_VARIANT = 30
VARIANTS = [
    "deepseek-v4pro-searxng",
    "deepseek-v32exp-searxng",
    "qwen3max-searxng",
]


def main() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    out_path = os.path.join(os.path.dirname(__file__), "failed_runs.jsonl")
    total = 0
    with open(out_path, "w") as f:
        for variant in VARIANTS:
            rows = fetch_all(
                "pipeline_runs",
                {
                    "created_at": f"gte.{cutoff}",
                    "ab_test_picks->>simple_bot_search": f"eq.{variant}",
                    "outcome": "in.(rejected,failed)",
                    "select": "id,created_at,outcome,outcome_reason,note_text,source_url,check_reasoning,logs,ab_test_picks",
                    "order": "created_at.desc",
                },
            )
            kept = rows[:MAX_PER_VARIANT]
            for r in kept:
                f.write(json.dumps({**r, "_variant": variant}) + "\n")
            print(f"  {variant:30s}  total={len(rows):4d}  kept={len(kept)}")
            total += len(kept)

    print(f"\nWrote {total} rows to {out_path}")


if __name__ == "__main__":
    main()
