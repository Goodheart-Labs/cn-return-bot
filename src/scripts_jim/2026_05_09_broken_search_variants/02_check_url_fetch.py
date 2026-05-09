"""Re-fetch every URL cited in the failed runs from 01, with the same
User-Agent and timeout the bot's fetcher uses
([src/pipeline/tool-calling/tools.ts:314](../../pipeline/tool-calling/tools.ts)).

For each URL, bucket the failure into:
  ok           → 2xx with text content
  http_4xx     → 4xx (404 = gone, 403 = blocked)
  http_5xx     → 5xx
  redirect_loop → too many redirects
  timeout      → 15s exceeded
  dns          → name resolution failed
  ssl          → cert error
  truncated    → URL string ends mid-path (length suspicious + last char not '/' or alnum)
  other        → other network error
  non_text     → 2xx but content-type isn't text/* or */json

Then group the results per variant. If `truncated` dominates → searxng issue.
If `http_4xx` (404) dominates → model hallucinates. If `http_4xx` (403) /
`timeout` → site-block.

Output: url_fetch_buckets.json (summary) and url_fetch_details.jsonl (per-URL).
"""

import json
import os
import re
import socket
import ssl
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from typing import Iterable

USER_AGENT = "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)"
TIMEOUT_SECONDS = 15

# Heuristic: URLs that look truncated (cut off mid-path or query)
TRUNCATED_TAIL_PATTERN = re.compile(r"[a-zA-Z]\.\.\.$|/[a-z0-9]{30,}$")  # tweak as needed


def categorize(url: str) -> tuple[str, str]:
    """Return (bucket, detail). One request per URL."""
    if TRUNCATED_TAIL_PATTERN.search(url):
        return ("truncated", "matched truncation heuristic")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            ct = resp.headers.get("Content-Type", "") or ""
            if not ("text/" in ct or "json" in ct):
                return ("non_text", ct)
            return ("ok", str(resp.status))
    except urllib.error.HTTPError as e:
        bucket = "http_4xx" if 400 <= e.code < 500 else "http_5xx"
        return (bucket, str(e.code))
    except urllib.error.URLError as e:
        if isinstance(e.reason, socket.gaierror):
            return ("dns", str(e.reason))
        if isinstance(e.reason, ssl.SSLError):
            return ("ssl", str(e.reason))
        if isinstance(e.reason, TimeoutError):
            return ("timeout", "timeout")
        return ("other", str(e.reason)[:120])
    except (socket.timeout, TimeoutError):
        return ("timeout", "timeout")
    except Exception as e:
        return ("other", f"{type(e).__name__}: {str(e)[:120]}")


def extract_urls(s: str | None) -> list[str]:
    if not s:
        return []
    return re.findall(r"https?://\S+", s)


def main() -> None:
    in_path = os.path.join(os.path.dirname(__file__), "failed_runs.jsonl")
    if not os.path.exists(in_path):
        raise SystemExit(f"Missing {in_path}. Run 01_pull_failed_runs.py first.")

    rows = [json.loads(line) for line in open(in_path)]
    print(f"Loaded {len(rows)} failed runs.")

    out_jsonl = os.path.join(os.path.dirname(__file__), "url_fetch_details.jsonl")
    out_summary = os.path.join(os.path.dirname(__file__), "url_fetch_buckets.json")

    by_variant_bucket: dict[str, Counter[str]] = defaultdict(Counter)
    seen: set[str] = set()
    n_urls = 0

    with open(out_jsonl, "w") as f_out:
        for r in rows:
            urls = extract_urls(r.get("note_text") or "") + extract_urls(r.get("source_url") or "")
            for url in urls:
                url = url.rstrip(".,;)")
                if url in seen:
                    continue
                seen.add(url)
                bucket, detail = categorize(url)
                by_variant_bucket[r["_variant"]][bucket] += 1
                f_out.write(json.dumps({"variant": r["_variant"], "url": url, "bucket": bucket, "detail": detail}) + "\n")
                n_urls += 1
                if n_urls % 25 == 0:
                    print(f"  …{n_urls} URLs categorized")

    summary = {variant: dict(counter) for variant, counter in by_variant_bucket.items()}
    with open(out_summary, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nCategorized {n_urls} unique URLs.")
    print(f"  details: {out_jsonl}")
    print(f"  summary: {out_summary}\n")
    for variant, counts in summary.items():
        total = sum(counts.values())
        print(f"{variant}  ({total} URLs)")
        for bucket, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"  {bucket:14s}  {n:4d}  ({n / total:.0%})")
        print()


if __name__ == "__main__":
    main()
