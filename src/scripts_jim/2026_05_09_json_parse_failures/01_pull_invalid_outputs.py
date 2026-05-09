"""Pull rows where the LLM returned non-JSON content and bucket them by
provider + content shape. After A8 in the error-handling refactor lands,
these surface as `outcome_reason='model_output_invalid'`. Pre-refactor
rows used `outcome_reason='bot_error'` with `error_message LIKE '%not
valid JSON%'` — we include those too for backfill comparability.

Buckets (content shape, extracted from the error_message which embeds the
first 200 chars of the offending content):
  empty            content="" (provider returned no content)
  markdown_fenced  starts with ```json or contains ``` fences
  preamble         starts with English prose then has { later
  plain_text       no JSON-like structure at all
  truncated_json   starts with { but truncates mid-value
  other            anything else

Per (bucket × provider) we get a count and a sample row.

Output: invalid_output_buckets.json + invalid_output_samples.json
"""

import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from _supabase import fetch_all

LOOKBACK_DAYS = 14


def shape(content: str) -> str:
    s = content.strip()
    if not s:
        return "empty"
    if s.startswith("```") or "```json" in s or "```\n{" in s:
        return "markdown_fenced"
    if s.startswith("{") and not s.endswith("}"):
        return "truncated_json"
    if s.startswith("{"):
        return "other"  # starts with { but isn't truncated — shouldn't happen often
    if "{" in s[:50]:
        return "preamble"  # short preamble before JSON
    if "{" in s:
        return "preamble"
    return "plain_text"


def extract_content_from_error(msg: str) -> str:
    """Error messages have the form `<source>: model output was not valid
    JSON. content="<first 200 chars>"`."""
    m = re.search(r'content="((?:[^"\\]|\\.)*)"', msg or "")
    if not m:
        return ""
    return m.group(1).encode().decode("unicode_escape", errors="replace")


def main() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()

    # Two filters OR'd: post-refactor rows with the new outcome_reason, plus
    # historical bot_error rows whose message names a JSON parse failure.
    rows = fetch_all(
        "pipeline_runs",
        {
            "created_at": f"gte.{cutoff}",
            "outcome": "eq.failed",
            "or": "(outcome_reason.eq.model_output_invalid,error_message.ilike.*not valid JSON*)",
            "select": "id,created_at,outcome_reason,error_message,ab_test_picks,bot_name",
            "order": "created_at.desc",
        },
    )
    print(f"Found {len(rows)} JSON-parse failures in last {LOOKBACK_DAYS} days.\n")

    by_bucket_provider: dict[tuple[str, str], int] = Counter()
    samples: dict[tuple[str, str], dict] = {}

    for r in rows:
        msg = r.get("error_message") or ""
        content = extract_content_from_error(msg)
        bucket = shape(content)
        provider = (r.get("ab_test_picks") or {}).get("simple_bot_search") or r.get("bot_name") or "(unknown)"
        key = (provider, bucket)
        by_bucket_provider[key] += 1
        if key not in samples:
            samples[key] = {
                "id": r["id"],
                "created_at": r["created_at"][:19],
                "error_message": msg[:200],
                "extracted_content": content[:200],
            }

    # Pretty-print summary table.
    providers = sorted({p for p, _ in by_bucket_provider})
    buckets = ["empty", "markdown_fenced", "preamble", "truncated_json", "plain_text", "other"]

    print(f"{'provider':<30s}  " + "  ".join(f"{b:>16s}" for b in buckets) + "  total")
    print("-" * (30 + 18 * len(buckets) + 8))
    for p in providers:
        counts = [by_bucket_provider.get((p, b), 0) for b in buckets]
        total = sum(counts)
        print(f"{p:<30s}  " + "  ".join(f"{c:>16d}" for c in counts) + f"  {total:5d}")
    print()

    out_dir = os.path.dirname(__file__)
    with open(os.path.join(out_dir, "invalid_output_buckets.json"), "w") as f:
        json.dump({f"{p}/{b}": n for (p, b), n in by_bucket_provider.items()}, f, indent=2)
    with open(os.path.join(out_dir, "invalid_output_samples.json"), "w") as f:
        json.dump({f"{p}/{b}": v for (p, b), v in samples.items()}, f, indent=2)
    print(f"Wrote summary + samples to {out_dir}")


if __name__ == "__main__":
    main()
