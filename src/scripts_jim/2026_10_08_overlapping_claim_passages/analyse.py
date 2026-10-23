# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "python-dotenv"]
# ///
"""Finds overlapping context quotes between the claims of one item and writes results.json and samples.md."""

import json
import random
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from fetch import load_data

HERE = Path(__file__).parent
SEED = 20261008
SAMPLES_PER_CLASS = {"PARTIAL": 15, "NESTED": 15, "IDENTICAL": 10}
EDGE_WORD_COUNT = 8
MAX_LENGTH_RATIO_FOR_LOOSE_MATCH = 2
LOOSE_MATCH_SLACK_WORDS = 20
PAIR_CLASSES = ["IDENTICAL", "NESTED", "PARTIAL"]
NOT_FACT_CHECKED_JUDGEMENTS = {"certainly true", "likely true", "somewhat likely true"}
WORD = re.compile(r"\w+")


@dataclass
class Placed:
    claim: dict
    start: int
    end: int
    how: str


# ---------- placing a quote in the item text ----------

def words_with_spans(text: str) -> tuple[list[str], list[tuple[int, int]]]:
    matches = list(WORD.finditer(text))
    return [m.group().lower() for m in matches], [m.span() for m in matches]


def build_ngram_index(words: list[str]) -> dict[tuple[str, ...], list[int]]:
    index: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for i in range(len(words) - EDGE_WORD_COUNT + 1):
        index[tuple(words[i : i + EDGE_WORD_COUNT])].append(i)
    return index


def find_sequence(words: list[str], index: dict, sequence: list[str]) -> list[int]:
    if len(sequence) >= EDGE_WORD_COUNT:
        return index.get(tuple(sequence[:EDGE_WORD_COUNT]), [])
    return [i for i in range(len(words) - len(sequence) + 1) if words[i : i + len(sequence)] == sequence]


def place_loosely(quote: str, words, spans, index) -> tuple[int, int, bool] | None:
    """Matches the first and last 8 words of the quote, ignoring case and punctuation.

    The third value says whether all words in between match too, so only spacing and punctuation differ.
    """
    quote_words = [m.group().lower() for m in WORD.finditer(quote)]
    if not quote_words:
        return None
    head = quote_words[:EDGE_WORD_COUNT]
    tail = quote_words[-EDGE_WORD_COUNT:]
    max_words = len(quote_words) * MAX_LENGTH_RATIO_FOR_LOOSE_MATCH + LOOSE_MATCH_SLACK_WORDS
    for head_pos in find_sequence(words, index, head):
        if words[head_pos : head_pos + len(head)] != head:
            continue
        for tail_pos in find_sequence(words, index, tail):
            tail_end = tail_pos + len(tail)
            if tail_end >= head_pos + len(head) and tail_end - head_pos <= max_words and words[tail_pos:tail_end] == tail:
                return spans[head_pos][0], spans[tail_end - 1][1], words[head_pos:tail_end] == quote_words
    return None


def place_claims(item_text: str, claims: list[dict], field: str) -> tuple[list[Placed], list[dict]]:
    placed, failed = [], []
    words = spans = index = None
    for claim in claims:
        quote = claim[field]
        position = item_text.find(quote)
        if position >= 0:
            placed.append(Placed(claim, position, position + len(quote), "exact"))
            continue
        if words is None:
            words, spans = words_with_spans(item_text)
            index = build_ngram_index(words)
        loose = place_loosely(quote, words, spans, index)
        if loose:
            placed.append(Placed(claim, loose[0], loose[1], "same_words" if loose[2] else "drifted"))
        else:
            failed.append(claim)
    return placed, failed


# ---------- pair classification ----------

def classify(a: Placed, b: Placed) -> str:
    if (a.start, a.end) == (b.start, b.end):
        return "IDENTICAL"
    a_in_b = b.start <= a.start and a.end <= b.end
    b_in_a = a.start <= b.start and b.end <= a.end
    return "NESTED" if a_in_b or b_in_a else "PARTIAL"


def overlapping_pairs(placed: list[Placed]) -> list[tuple[Placed, Placed, str]]:
    ordered = sorted(placed, key=lambda p: (p.start, p.end))
    pairs, active = [], []
    for current in ordered:
        active = [p for p in active if p.end > current.start]
        for earlier in active:
            pairs.append((earlier, current, classify(earlier, current)))
        active.append(current)
    return pairs


def coverage_depth_chars(text_length: int, placed: list[Placed], depth_counter: Counter) -> None:
    events = sorted([(p.start, 1) for p in placed] + [(p.end, -1) for p in placed])
    depth, previous = 0, 0
    for position, change in events:
        depth_counter[min(depth, 3)] += position - previous
        depth, previous = depth + change, position
    depth_counter[0] += text_length - previous


def clusters(placed: list[Placed]) -> list[tuple[int, int, int]]:
    """Merges quotes that overlap into passages. Returns (start, end, claim count) per passage."""
    result: list[list[int]] = []
    for p in sorted(placed, key=lambda p: (p.start, p.end)):
        if result and p.start < result[-1][1]:
            result[-1][1] = max(result[-1][1], p.end)
            result[-1][2] += 1
        else:
            result.append([p.start, p.end, 1])
    return [tuple(r) for r in result]


# ---------- the analysis of one text field ----------

def analyse_field(extractor_claims_by_item, items, field: str, keep_pairs: bool):
    stats = {
        "claims_total": 0, "placed_exact": 0, "placed_same_words": 0, "placed_drifted": 0, "not_placed": 0,
        "pairs": Counter(), "claims_in_class": {c: set() for c in PAIR_CLASSES},
        "depth_chars": Counter(), "total_chars": 0, "items_used": 0,
        "overlap_chars_of_shorter": {"NESTED": [], "PARTIAL": []},
        "passage_chars": [], "passage_claims": [], "claim_ids_placed": set(),
        "claim_category": {},
    }
    pair_records = defaultdict(list)
    for item_id, claims in extractor_claims_by_item.items():
        item = items.get(item_id)
        with_field = [c for c in claims if c[field]]
        stats["claims_total"] += len(with_field)
        if not item or not item["full_text"]:
            stats["not_placed"] += len(with_field)
            continue
        placed, failed = place_claims(item["full_text"], with_field, field)
        stats["not_placed"] += len(failed)
        stats["placed_exact"] += sum(p.how == "exact" for p in placed)
        stats["placed_same_words"] += sum(p.how == "same_words" for p in placed)
        stats["placed_drifted"] += sum(p.how == "drifted" for p in placed)
        if not placed:
            continue
        stats["items_used"] += 1
        stats["total_chars"] += len(item["full_text"])
        coverage_depth_chars(len(item["full_text"]), placed, stats["depth_chars"])
        for p in placed:
            stats["claim_ids_placed"].add(p.claim["id"])
        for a, b, kind in overlapping_pairs(placed):
            stats["pairs"][kind] += 1
            stats["claims_in_class"][kind].update([a.claim["id"], b.claim["id"]])
            overlap = min(a.end, b.end) - max(a.start, b.start)
            if kind in stats["overlap_chars_of_shorter"]:
                shorter = min(a.end - a.start, b.end - b.start)
                stats["overlap_chars_of_shorter"][kind].append(overlap / shorter)
            if keep_pairs:
                pair_records[kind].append((item, a, b, overlap))
        for start, end, count in clusters(placed):
            stats["passage_chars"].append(end - start)
            stats["passage_claims"].append(count)
    return stats, pair_records


def claim_categories(stats) -> dict[str, str]:
    """Each placed claim gets the most awkward class it takes part in."""
    categories = {}
    for claim_id in stats["claim_ids_placed"]:
        for kind in ["PARTIAL", "NESTED", "IDENTICAL"]:
            if claim_id in stats["claims_in_class"][kind]:
                categories[claim_id] = kind
                break
        else:
            categories[claim_id] = "NONE"
    return categories


# ---------- importance ----------

def importance(categories, claims_by_id, notes):
    notes_by_claim = defaultdict(list)
    for n in notes:
        notes_by_claim[n["claim_id"]].append(n)
    rows = {}
    for kind in ["NONE", "IDENTICAL", "NESTED", "PARTIAL"]:
        ids = [i for i, c in categories.items() if c == kind]
        ai = sum(any(n["author_id"] is None for n in notes_by_claim[i]) for i in ids)
        reader = sum(any(n["author_id"] is not None for n in notes_by_claim[i]) for i in ids)
        any_note = sum(bool(notes_by_claim[i]) for i in ids)
        judgements = Counter(claims_by_id[i]["judgement"] for i in ids)
        checked = sum(v for j, v in judgements.items() if j not in NOT_FACT_CHECKED_JUDGEMENTS)
        rows[kind] = {"claims": len(ids), "with_any_note": any_note, "with_ai_note": ai,
                      "with_reader_note": reader, "fact_checked": checked, "judgements": dict(judgements)}
    return rows


# ---------- samples ----------

def indent(text: str) -> str:
    return "\n".join("> " + line for line in text.splitlines() or [""])


def write_samples(pair_records, field: str) -> None:
    rng = random.Random(SEED)
    lines = ["# Sampled overlapping pairs of context quotes\n",
             f"Seed {SEED}. Each pair is two claims of one item whose `{field}` intervals overlap.\n"]
    for kind in ["PARTIAL", "NESTED", "IDENTICAL"]:
        records = pair_records[kind]
        sample = rng.sample(records, min(SAMPLES_PER_CLASS[kind], len(records)))
        lines.append(f"\n## {kind} ({len(sample)} of {len(records)} pairs)\n")
        for number, (item, a, b, overlap) in enumerate(sample, 1):
            overlap_text = item["full_text"][max(a.start, b.start) : min(a.end, b.end)]
            lines += [
                f"### {kind} {number}: {item['title']}",
                f"Item: {item['url']}  (overlap {overlap} characters; quote A {a.end - a.start}, quote B {b.end - b.start})\n",
                f"**Claim A** ({a.claim['judgement']}): {a.claim['claim']}\n", indent(item["full_text"][a.start : a.end]) + "\n",
                f"**Claim B** ({b.claim['judgement']}): {b.claim['claim']}\n", indent(item["full_text"][b.start : b.end]) + "\n",
                "**Exact overlapping text:**\n", indent(overlap_text) + "\n",
            ]
    (HERE / "samples.md").write_text("\n".join(lines))


# ---------- summary ----------

def summarise(stats) -> dict:
    ratios = stats["overlap_chars_of_shorter"]
    median = lambda xs: round(statistics.median(xs), 3) if xs else None
    total = stats["total_chars"] or 1
    placed = stats["placed_exact"] + stats["placed_same_words"] + stats["placed_drifted"]
    return {
        "claims_with_text": stats["claims_total"], "placed_exact": stats["placed_exact"],
        "placed_same_words": stats["placed_same_words"], "placed_drifted": stats["placed_drifted"], "not_placed": stats["not_placed"],
        "not_placed_share": round(stats["not_placed"] / max(stats["claims_total"], 1), 4),
        "items_used": stats["items_used"],
        "pairs": {k: stats["pairs"][k] for k in PAIR_CLASSES},
        "claims_in_class": {k: len(stats["claims_in_class"][k]) for k in PAIR_CLASSES},
        "claims_in_any_overlap": len(set().union(*stats["claims_in_class"].values())),
        "claims_placed": placed,
        "coverage_share_by_depth": {d: round(stats["depth_chars"][d] / total, 4) for d in range(4)},
        "median_overlap_share_of_shorter_quote": {k: median(v) for k, v in ratios.items()},
        "merged_passage_chars_median": median(stats["passage_chars"]),
        "merged_passage_chars_p90": round(statistics.quantiles(stats["passage_chars"], n=10)[-1]) if len(stats["passage_chars"]) > 10 else None,
        "merged_passage_claims_median": median(stats["passage_claims"]),
        "merged_passage_claims_p90": round(statistics.quantiles(stats["passage_claims"], n=10)[-1]) if len(stats["passage_claims"]) > 10 else None,
        "merged_passages": len(stats["passage_chars"]),
        "merged_passage_chars_p99": round(statistics.quantiles(stats["passage_chars"], n=100)[-1]) if len(stats["passage_chars"]) > 100 else None,
        "merged_passage_chars_max": max(stats["passage_chars"], default=None),
        "merged_passage_claims_max": max(stats["passage_claims"], default=None),
        "claims_in_multi_claim_passages": sum(c for c in stats["passage_claims"] if c > 1),
    }


def main() -> None:
    claims, notes, items = load_data()
    reader_claims = [c for c in claims if c["judgement"] == "user"]
    extractor = [c for c in claims if c["judgement"] != "user"]
    with_quote = [c for c in extractor if c["context_quote"]]
    by_item = defaultdict(list)
    for c in with_quote:
        by_item[c["item_id"]].append(c)
    claims_by_id = {c["id"]: c for c in claims}

    quote_stats, pair_records = analyse_field(by_item, items, "context_quote", keep_pairs=True)
    paragraph_stats, _ = analyse_field(by_item, items, "context_paragraph", keep_pairs=False)
    write_samples(pair_records, "context_quote")

    categories = claim_categories(quote_stats)
    result = {
        "all_claims": len(claims), "reader_added_claims": len(reader_claims),
        "extractor_claims": len(extractor), "extractor_claims_without_quote": len(extractor) - len(with_quote),
        "extractor_claims_with_quote": len(with_quote), "items": len(by_item),
        "quote": summarise(quote_stats), "paragraph": summarise(paragraph_stats),
        "importance_by_quote_category": importance(categories, claims_by_id, notes),
        "all_judgements": dict(Counter(c["judgement"] for c in extractor)),
        "notes_total": len(notes),
    }
    (HERE / "results.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
