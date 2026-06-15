"""
Construct a query-writer evaluation dataset from datasets/big_eval/dataset.jsonl.

Goal: for each candidate row, the input is the *post context* (what the bot sees
before any LLM call) and the target is the set of *reference URLs / domains*
that the original good correction cited. A query writer that emits queries
which surface those reference URLs / domains is doing its job.

Output files (all under datasets/query_writer_eval/):
- all_candidates.jsonl   — every yes+url row that has a cached input file
- few_shot_pool.jsonl    — ~30 high-quality, diverse rows kept out of train/val/test
- val.jsonl              — 60 rows for hill-climbing prompt variants
- test.jsonl             — 80 rows held out for final evaluation
- train.jsonl            — rest, available for future tuning / few-shot mining

Splits are stratified by primary v2 territory category to keep them comparable.
"""

import json
import os
import random
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
DATASET = ROOT / "datasets" / "big_eval" / "dataset.jsonl"
INPUTS = ROOT / "datasets" / "big_eval" / "inputs"
OUT = ROOT / "datasets" / "query_writer_eval"
OUT.mkdir(exist_ok=True)

URL_RE = re.compile(r"https?://[^\s)\]]+")
TRAILING_PUNCT = ".,);]\"'"


def extract_urls(text: str) -> list[str]:
    if not text:
        return []
    out = []
    for u in URL_RE.findall(text):
        while u and u[-1] in TRAILING_PUNCT:
            u = u[:-1]
        out.append(u)
    return out


def host_etld1(url: str) -> str:
    """Cheap eTLD+1: strip leading www and m, take last 2 labels."""
    try:
        h = urlparse(url).hostname or ""
    except Exception:
        return ""
    h = h.lower()
    if h.startswith("www."):
        h = h[4:]
    if h.startswith("m."):
        h = h[2:]
    parts = h.split(".")
    if len(parts) <= 2:
        return h
    # crude: handle co.uk, gov.uk, com.au
    second = parts[-2]
    if second in ("co", "gov", "com", "org", "net", "ac") and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


SOCIAL_DOMAINS = {
    "x.com",
    "twitter.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com",
    "threads.net",
    "youtube.com",
    "youtu.be",
    "t.me",
}


def is_social(url: str) -> bool:
    return host_etld1(url) in SOCIAL_DOMAINS


def primary_category(row: dict) -> str:
    cats = row.get("categories") or []
    if cats:
        return cats[0]
    return "uncategorized"


def main():
    rows = [json.loads(l) for l in DATASET.open()]
    print(f"loaded {len(rows)} dataset rows")

    candidates = []
    skipped = defaultdict(int)
    for r in rows:
        if r.get("needs_note") != "yes":
            skipped["not_needs_note_yes"] += 1
            continue
        urls = extract_urls(r.get("reference_note", "") or "")
        if not urls:
            skipped["no_reference_urls"] += 1
            continue
        non_social = [u for u in urls if not is_social(u)]
        if not non_social:
            skipped["only_social_urls"] += 1
            continue
        input_path = INPUTS / f"{r['tweet_id']}.json"
        if not input_path.exists():
            skipped["no_cached_input"] += 1
            continue

        ref_domains = sorted({host_etld1(u) for u in non_social if host_etld1(u)})
        all_domains = sorted({host_etld1(u) for u in urls if host_etld1(u)})
        candidates.append({
            "tweet_id": r["tweet_id"],
            "url": r["url"],
            "tweet_text": r["tweet_text"],
            "tweet_summary": r.get("tweet_summary", ""),
            "categories": r.get("categories", []),
            "primary_category": primary_category(r),
            "why_note_decision": r.get("why_note_decision", ""),
            "reference_note": r.get("reference_note", ""),
            "reference_urls": urls,
            "reference_urls_non_social": non_social,
            "reference_domains": ref_domains,
            "reference_domains_all": all_domains,
            "judge_guidance": r.get("judge_guidance", ""),
            "original_note_text": r.get("original_note_text", ""),
            "difficulty": r.get("difficulty", "unknown"),
            "importance_prominence": r.get("importance_prominence", "unknown"),
        })

    print(f"candidates: {len(candidates)}; skipped: {dict(skipped)}")

    # Stratified split by primary_category.
    by_cat = defaultdict(list)
    for c in candidates:
        by_cat[c["primary_category"]].append(c)
    print(f"primary_category buckets: {len(by_cat)}")

    rng = random.Random(20260527)
    few_shot_pool, val, test, train = [], [], [], []
    target_few_shot = 30
    target_val = 60
    target_test = 80
    total = len(candidates)

    # Fractions
    few_shot_frac = target_few_shot / total
    val_frac = target_val / total
    test_frac = target_test / total

    for cat, rows in sorted(by_cat.items()):
        rng.shuffle(rows)
        n = len(rows)
        n_fs = max(1, round(n * few_shot_frac)) if n >= 3 else 0
        n_val = max(1, round(n * val_frac)) if n >= 2 else 0
        n_test = max(1, round(n * test_frac)) if n >= 2 else 0
        # Don't overdraw
        remaining = n - n_fs
        n_val = min(n_val, remaining)
        remaining -= n_val
        n_test = min(n_test, remaining)
        remaining -= n_test

        i = 0
        few_shot_pool.extend(rows[i : i + n_fs]); i += n_fs
        val.extend(rows[i : i + n_val]); i += n_val
        test.extend(rows[i : i + n_test]); i += n_test
        train.extend(rows[i:])

    # Trim oversized splits randomly so we hit the targets exactly.
    rng.shuffle(few_shot_pool); few_shot_pool = few_shot_pool[:target_few_shot]
    rng.shuffle(val); val = val[:target_val]
    rng.shuffle(test); test = test[:target_test]

    # Anything trimmed off val/test/few_shot flows into train (so we don't lose rows).
    used = {c["tweet_id"] for c in few_shot_pool + val + test}
    train = [c for c in candidates if c["tweet_id"] not in used]

    def write(name: str, rows: list):
        p = OUT / f"{name}.jsonl"
        with p.open("w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print(f"wrote {name}: {len(rows)} -> {p}")

    write("all_candidates", candidates)
    write("few_shot_pool", few_shot_pool)
    write("val", val)
    write("test", test)
    write("train", train)

    # Print distribution
    def cat_dist(rows):
        from collections import Counter
        return Counter(r["primary_category"] for r in rows)

    print("\nval distribution:")
    for c, n in cat_dist(val).most_common():
        print(f"  {n:3d}  {c}")
    print("\ntest distribution:")
    for c, n in cat_dist(test).most_common():
        print(f"  {n:3d}  {c}")


if __name__ == "__main__":
    main()
