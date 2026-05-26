"""
Phase 7: assemble the big_eval dataset and write splits + report.

Inputs:
  - datasets/big_eval/annotations/<tweet_id>.json  (657)
  - datasets/big_eval/inputs/<tweet_id>.json       (cached bot inputs, 657)
  - datasets/big_eval/selected.jsonl               (745)

Outputs (datasets/big_eval/):
  - dataset.jsonl                       full joined records
  - splits/test.jsonl + test.csv        100 rows, stratified 50/50 needs_note
  - splits/val.jsonl + val.csv          100 rows, stratified 50/50 needs_note
  - splits/pool.jsonl + pool.csv        rest (preserves overall distribution)
  - report.md                           distributions, examples, taxonomy hints

CSV columns match localPipelineRunner.ts + the extended judgeRow:
  url, needs_note, ground_truth_note, tweet_text, tags,
  judge_guidance, original_note_text, failure_reason.

Deterministic: numpy not used; stratification + sampling are pure-Python with a
fixed seed.
"""
import csv
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIG_EVAL = HERE.parent.parent.parent / "datasets" / "big_eval"
ANN_DIR = BIG_EVAL / "annotations"
INPUTS_DIR = BIG_EVAL / "inputs"
SELECTED = BIG_EVAL / "selected.jsonl"
SPLITS_DIR = BIG_EVAL / "splits"
DATASET_PATH = BIG_EVAL / "dataset.jsonl"
REPORT_PATH = BIG_EVAL / "report.md"

SEED = 20260525
TEST_SIZE = 100
VAL_SIZE = 100

CSV_COLS = [
    "url",
    "needs_note",
    "ground_truth_note",
    "tweet_text",
    "tags",
    "judge_guidance",
    "original_note_text",
    "failure_reason",
]


def tweet_url(tid: str) -> str:
    return f"https://x.com/i/status/{tid}"


def load_selected_by_tid() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for ln in SELECTED.open():
        r = json.loads(ln)
        out[str(r["tweet_id"])] = r
    return out


def join_record(annotation: dict, cached: dict, selected: dict | None) -> dict:
    post = cached.get("post") or {}
    bi = cached.get("botInput") or {}
    media = post.get("media") or []
    metrics = post.get("public_metrics") or {}
    mr = bi.get("mediaResult") or {}
    tweet_media_desc = mr.get("tweetMedia") if isinstance(mr, dict) else None

    original = annotation.get("original_unhelpful_note") or {}
    importance = annotation.get("importance") or {}

    tid = str(annotation["tweet_id"])
    return {
        "tweet_id": tid,
        "url": tweet_url(tid),
        "tweet_text": post.get("text", ""),
        "tweet_created_at": post.get("created_at"),
        "author_name": post.get("author_name"),
        "author_followers": post.get("author_followers"),
        "author_description": post.get("author_description"),
        "media": media,
        "media_description": tweet_media_desc,
        "comments": bi.get("comments", ""),
        "impressions": metrics.get("impression_count"),
        "view_count": metrics.get("view_count"),
        "like_count": metrics.get("like_count"),
        "needs_note": annotation.get("needs_note"),
        "role": annotation.get("role"),
        "provisional_role": annotation.get("provisional_role"),
        "disagrees_with_provisional": annotation.get("disagrees_with_provisional", False),
        "categories": annotation.get("categories", []),
        "category_fit": annotation.get("category_fit"),
        "suggested_category": annotation.get("suggested_category", ""),
        "no_note_reason": annotation.get("no_note_reason", ""),
        "tweet_summary": annotation.get("tweet_summary", ""),
        "why_note_decision": annotation.get("why_note_decision", ""),
        "judge_guidance": annotation.get("judge_guidance", ""),
        "reference_note": annotation.get("reference_note", ""),
        "original_note_text": original.get("text", "") if isinstance(original, dict) else "",
        "failure_reason": original.get("failure_reason", "") if isinstance(original, dict) else "",
        "original_note_status": original.get("original_status", "") if isinstance(original, dict) else "",
        "current_status": (selected or {}).get("current_status"),
        "rating_volume": (selected or {}).get("rating_volume"),
        "selection_bucket": (selected or {}).get("selection_bucket"),
        "source": (selected or {}).get("source"),
        "media_confidence": annotation.get("media_confidence", "high"),
        "media_reliability_flag": annotation.get("media_reliability_flag", False),
        "importance_prominence": importance.get("prominence") if isinstance(importance, dict) else None,
        "importance_lens_rationale": importance.get("lens_rationale") if isinstance(importance, dict) else None,
        "difficulty": annotation.get("difficulty"),
    }


def assemble() -> list[dict]:
    selected_by_tid = load_selected_by_tid()
    records: dict[str, dict] = {}
    skipped_no_input = 0
    for fp in sorted(ANN_DIR.glob("*.json")):
        a = json.loads(fp.read_text())
        tid = str(a["tweet_id"])
        input_path = INPUTS_DIR / f"{tid}.json"
        if not input_path.exists():
            skipped_no_input += 1
            continue
        cached = json.loads(input_path.read_text())
        records[tid] = join_record(a, cached, selected_by_tid.get(tid))
    if skipped_no_input:
        print(f"  skipped {skipped_no_input} annotations with no cached input")
    return list(records.values())


def primary_category(r: dict) -> str:
    cats = r.get("categories") or []
    return cats[0] if cats else "uncategorized"


def stratified_sample(rows: list[dict], n: int, rng: random.Random) -> tuple[list[dict], list[dict]]:
    by_strata: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_strata[primary_category(r)].append(r)

    total = len(rows)
    chosen: list[dict] = []
    leftover: list[dict] = []
    for group in by_strata.values():
        rng.shuffle(group)
        take = min(round(len(group) / total * n) if total else 0, len(group))
        chosen.extend(group[:take])
        leftover.extend(group[take:])

    rng.shuffle(leftover)
    while len(chosen) < n and leftover:
        chosen.append(leftover.pop(0))
    while len(chosen) > n:
        leftover.append(chosen.pop())
    return chosen, leftover


def balanced_split(rows: list[dict], n: int, rng: random.Random) -> tuple[list[dict], list[dict]]:
    yes = [r for r in rows if r["needs_note"] == "yes"]
    no = [r for r in rows if r["needs_note"] == "no"]
    take_yes = min(n // 2, len(yes))
    take_no = min(n - take_yes, len(no))
    yes_sample, yes_rest = stratified_sample(yes, take_yes, rng)
    no_sample, no_rest = stratified_sample(no, take_no, rng)
    sampled = yes_sample + no_sample
    rng.shuffle(sampled)
    return sampled, yes_rest + no_rest


def to_csv_row(r: dict) -> dict[str, str]:
    tags_parts = list(r.get("categories") or [])
    if r.get("no_note_reason"):
        tags_parts.append(f"no_note_reason:{r['no_note_reason']}")
    return {
        "url": r["url"],
        "needs_note": r.get("needs_note") or "",
        "ground_truth_note": r.get("reference_note") or "",
        "tweet_text": (r.get("tweet_text") or "").replace("\n", " ").strip(),
        "tags": "|".join(tags_parts),
        "judge_guidance": r.get("judge_guidance") or "",
        "original_note_text": r.get("original_note_text") or "",
        "failure_reason": r.get("failure_reason") or "",
    }


def write_split(name: str, rows: list[dict]) -> None:
    SPLITS_DIR.mkdir(parents=True, exist_ok=True)
    (SPLITS_DIR / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    with (SPLITS_DIR / f"{name}.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS)
        w.writeheader()
        for r in rows:
            w.writerow(to_csv_row(r))


def dist(rows: list[dict], key, top: int | None = None) -> list[tuple[str, int]]:
    c: Counter = Counter()
    for r in rows:
        val = key(r)
        if isinstance(val, list):
            for v in val:
                c[v] += 1
        else:
            c[val] += 1
    items = c.most_common(top)
    return items


def write_report(all_rows: list[dict], test: list[dict], val: list[dict], pool: list[dict]) -> None:
    lines: list[str] = []
    lines.append("# big_eval dataset report\n")
    lines.append(f"Total assembled rows: **{len(all_rows)}** "
                 f"(test={len(test)}, val={len(val)}, pool={len(pool)}).\n\n")

    nn = Counter(r["needs_note"] for r in all_rows)
    lines.append("## needs_note balance\n")
    for k in ("yes", "no"):
        n = nn.get(k, 0)
        pct = (n / len(all_rows) * 100) if all_rows else 0
        lines.append(f"- **{k}**: {n} ({pct:.1f}%)\n")
    lines.append("\n")

    lines.append("## Role distribution\n")
    for role, n in dist(all_rows, lambda r: r["role"]):
        lines.append(f"- `{role}`: {n}\n")
    lines.append("\n")

    lines.append("## no_note_reason distribution (rows where needs_note=no)\n")
    for reason, n in dist([r for r in all_rows if r["needs_note"] == "no"],
                          lambda r: r.get("no_note_reason") or "(unset)"):
        lines.append(f"- `{reason}`: {n}\n")
    lines.append("\n")

    lines.append("## Category coverage (multi-label, counts rows where category appears)\n")
    cat_counts = Counter()
    for r in all_rows:
        for c in r.get("categories") or []:
            cat_counts[c] += 1
    for c, n in cat_counts.most_common():
        lines.append(f"- `{c}`: {n}\n")
    lines.append("\n")

    lines.append("## Category × needs_note matrix\n\n")
    lines.append("| category | yes | no | total |\n|---|---:|---:|---:|\n")
    by_cat_yes: Counter = Counter()
    by_cat_no: Counter = Counter()
    for r in all_rows:
        for c in r.get("categories") or []:
            if r["needs_note"] == "yes":
                by_cat_yes[c] += 1
            else:
                by_cat_no[c] += 1
    for c in sorted(cat_counts, key=lambda k: -cat_counts[k]):
        lines.append(f"| {c} | {by_cat_yes[c]} | {by_cat_no[c]} | {cat_counts[c]} |\n")
    lines.append("\n")

    lines.append("## Disagreements with provisional label\n")
    flipped = [r for r in all_rows if r.get("disagrees_with_provisional")]
    lines.append(f"- {len(flipped)} of {len(all_rows)} rows ({len(flipped)/len(all_rows)*100:.0f}%) "
                 f"flipped from the provisional role during annotation.\n\n")

    lines.append("## Splits — needs_note balance\n\n")
    lines.append("| split | yes | no | total |\n|---|---:|---:|---:|\n")
    for name, rows in (("test", test), ("val", val), ("pool", pool)):
        y = sum(1 for r in rows if r["needs_note"] == "yes")
        n = sum(1 for r in rows if r["needs_note"] == "no")
        lines.append(f"| {name} | {y} | {n} | {len(rows)} |\n")
    lines.append("\n")

    lines.append("## suggested_category — top 30 (taxonomy v3 input)\n\n")
    sug = Counter(r["suggested_category"] for r in all_rows if r.get("suggested_category"))
    for s, n in sug.most_common(30):
        lines.append(f"- `{s}`: {n}\n")
    lines.append("\n")

    lines.append("## Difficulty distribution\n")
    for d, n in dist(all_rows, lambda r: r.get("difficulty") or "(unset)"):
        lines.append(f"- {d}: {n}\n")
    lines.append("\n")

    lines.append("## Importance / prominence\n")
    for p, n in dist(all_rows, lambda r: r.get("importance_prominence") or "(unset)"):
        lines.append(f"- {p}: {n}\n")
    lines.append("\n")

    lines.append("## Example test rows (5 yes + 5 no)\n\n")
    yes_examples = [r for r in test if r["needs_note"] == "yes"][:5]
    no_examples = [r for r in test if r["needs_note"] == "no"][:5]
    for r in yes_examples + no_examples:
        lines.append(f"### `{r['tweet_id']}` — needs_note={r['needs_note']}, role={r['role']}\n")
        lines.append(f"- Categories: {', '.join(r.get('categories') or []) or '(none)'}\n")
        if r.get("no_note_reason"):
            lines.append(f"- no_note_reason: `{r['no_note_reason']}`\n")
        text = (r.get("tweet_text") or "").replace("\n", " ").strip()
        lines.append(f"- Tweet: {text[:240]}{'…' if len(text) > 240 else ''}\n")
        guidance = (r.get("judge_guidance") or "").replace("\n", " ").strip()
        lines.append(f"- judge_guidance: {guidance[:300]}{'…' if len(guidance) > 300 else ''}\n\n")

    REPORT_PATH.write_text("".join(lines))


def main() -> None:
    print("Assembling...")
    rows = assemble()
    print(f"  joined {len(rows)} records")

    DATASET_PATH.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(f"  wrote {DATASET_PATH.relative_to(BIG_EVAL.parent.parent)}")

    rng = random.Random(SEED)
    rng.shuffle(rows)
    test, remaining = balanced_split(rows, TEST_SIZE, rng)
    val, pool = balanced_split(remaining, VAL_SIZE, rng)

    write_split("test", test)
    write_split("val", val)
    write_split("pool", pool)
    print(f"  splits: test={len(test)} val={len(val)} pool={len(pool)}")

    write_report(rows, test, val, pool)
    print(f"  wrote {REPORT_PATH.relative_to(BIG_EVAL.parent.parent)}")


if __name__ == "__main__":
    main()
