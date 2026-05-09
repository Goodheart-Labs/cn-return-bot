"""Compare URLs returned by searxng (in the run's logs) vs URLs the model
ended up citing in its note.

Hypothesis: searxng truncates URLs at some character limit, so the model
dutifully cites the truncated string. If true, we'll see a high rate of
"cited URL doesn't appear verbatim in any searxng result, but a *prefix
of it* does."

For each failed run with a searxng-using variant, this:
1. Pulls every URL out of the searxng search results in `logs`
2. Pulls every URL the model cited in `note_text` / `source_url`
3. For each cited URL: classify as `verbatim_match` / `prefix_in_results` /
   `not_in_results`. The middle bucket = strong evidence of truncation.

Output: searxng_url_match.json
"""

import json
import os
import re
from collections import Counter, defaultdict
from typing import Any

URL_RE = re.compile(r"https?://\S+")


def extract_urls(s: str | None) -> list[str]:
    if not s:
        return []
    return [u.rstrip(".,;)") for u in URL_RE.findall(s)]


def gather_searxng_urls(logs: dict[str, Any]) -> list[str]:
    """Walk the logs JSONB looking for searxng search-result URLs.

    The actual key path depends on the bot. For simple-bot's searxng loop,
    results land under logs.<step_name>.messages.<turn>.tool_result or similar.
    We scan every leaf string for URLs to be tolerant of schema drift."""
    urls: list[str] = []

    def visit(node: Any) -> None:
        if isinstance(node, str):
            urls.extend(extract_urls(node))
        elif isinstance(node, dict):
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    # Only walk subtrees that look like search-related (not the whole log).
    for key, value in logs.items():
        if "search" in key.lower() or "research" in key.lower():
            visit(value)
    return urls


def classify(cited: str, search_urls: list[str]) -> str:
    if cited in search_urls:
        return "verbatim_match"
    # Prefix match — same scheme+host+prefix-of-path
    for su in search_urls:
        if su.startswith(cited) or cited.startswith(su):
            return "prefix_in_results"
    return "not_in_results"


def main() -> None:
    in_path = os.path.join(os.path.dirname(__file__), "failed_runs.jsonl")
    if not os.path.exists(in_path):
        raise SystemExit(f"Missing {in_path}. Run 01_pull_failed_runs.py first.")

    rows = [json.loads(line) for line in open(in_path)]
    print(f"Loaded {len(rows)} runs.\n")

    by_variant: dict[str, Counter[str]] = defaultdict(Counter)
    samples_by_variant: dict[str, list[dict]] = defaultdict(list)

    for r in rows:
        logs = r.get("logs") or {}
        search_urls = list(set(gather_searxng_urls(logs)))
        cited_urls = list(set(extract_urls(r.get("note_text")) + extract_urls(r.get("source_url"))))
        for cited in cited_urls:
            cls = classify(cited, search_urls)
            by_variant[r["_variant"]][cls] += 1
            if cls == "prefix_in_results" and len(samples_by_variant[r["_variant"]]) < 3:
                samples_by_variant[r["_variant"]].append({"cited": cited, "search_pool_size": len(search_urls)})

    out_path = os.path.join(os.path.dirname(__file__), "searxng_url_match.json")
    summary = {v: dict(c) for v, c in by_variant.items()}
    with open(out_path, "w") as f:
        json.dump({"summary": summary, "samples": samples_by_variant}, f, indent=2)

    for variant, counts in summary.items():
        total = sum(counts.values())
        if total == 0:
            print(f"{variant}: no cited URLs (skipped)\n")
            continue
        print(f"{variant}  ({total} cited URLs)")
        for cls, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"  {cls:20s}  {n:4d}  ({n / total:.0%})")
        if samples_by_variant.get(variant):
            print("  prefix-mismatch samples (cited URL appears as prefix-of-or-superset-of a searxng result):")
            for s in samples_by_variant[variant]:
                print(f"    {s['cited']}")
        print()

    print(f"Wrote {out_path}")
    print()
    print("Interpretation:")
    print("  - High `not_in_results` → model cites URLs it never saw (hallucination).")
    print("  - High `prefix_in_results` → URLs differ at the tail (truncation suspected).")
    print("  - High `verbatim_match` → model cites real URLs; the rejection is something else.")


if __name__ == "__main__":
    main()
