"""
Phase 4: stratified selection of ~500 datapoints into selected.jsonl, honoring the
approved budget (~50% needs_note=no) and category diversity, with per-event dedupe.

Buckets (needs_note):
  no_note_needed         250  (no)   note-not-needed signal, round-robin across categories
  failure: incorrect      40  (yes)
  failure: missing_key    40  (yes)
  failure: opinion        30  (yes)
  failure: sources        30  (yes)  (missing/unreliable + irrelevant pooled)
  failure: hard           15  (yes)  best-effort, sourced via secondary tag
  helpful diversity       55  (yes)  across categories
  showcase: impact        15  (yes)  } heuristic shortlists; the showcase FLAG is
  showcase: impressive    10  (yes)  } confirmed/-corrected by Claude at annotation
  showcase: bridging      10  (yes)

  uv run src/scripts_jim/2026_05_25_big_eval_dataset/04_select.py
"""
import json
import random
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIG_EVAL = HERE.parent.parent.parent / "datasets" / "big_eval"
LABELED = BIG_EVAL / "corpus_labeled.jsonl"
OUT = BIG_EVAL / "selected.jsonl"
SEED = 42

NO_NOTE_TARGET = 250
HELP_DIVERSITY = 55
FAIL_TARGETS = {
    "incorrect": ("unhelpful_notHelpfulIncorrect", 40),
    "missing_key": ("unhelpful_notHelpfulMissingKeyPoints", 40),
    "opinion": ("unhelpful_notHelpfulOpinionSpeculation", 30),
}
SOURCES_ROLES = {"unhelpful_notHelpfulSourcesMissingOrUnreliable", "unhelpful_notHelpfulIrrelevantSources"}
SOURCES_TARGET = 30
HARD_TARGET = 15
SHOWCASE_TARGETS = {"impact_values_aligned": 15, "impressive_concise_debunk": 10, "bridging_cross_partisan": 10}
DEDUP_CAP = 2  # max notes sharing a signature (kills near-duplicate viral-event notes)

IMPACT_RE = re.compile(r"openai|anthropic|\bagi\b|\bllm\b|data ?center|\bgpu\b|pentagon|animal (welfare|agriculture|cruelty)|"
                       r"factory farm|\bvegan\b|biosecurity|pandemic|\bnuclear\b|climate|chatgpt|deepmind", re.I)


def prominence(r: dict) -> float:
    return max(r.get("rating_volume") or 0, (r.get("impressions") or 0) / 1000)


def sig(text: str) -> frozenset:
    words = sorted({w.lower() for w in re.findall(r"[A-Za-z]{5,}", text)}, key=len, reverse=True)[:5]
    return frozenset(words)


class Picker:
    def __init__(self, rows):
        self.rows = rows
        self.used: set[str] = set()
        self.sig_counts: Counter = Counter()
        self.selected: list[dict] = []

    def take(self, r: dict, bucket: str, showcase_hint: str | None = None) -> bool:
        if r["note_id"] in self.used:
            return False
        s = sig(r.get("note_text", ""))
        if self.sig_counts[s] >= DEDUP_CAP:
            return False
        self.used.add(r["note_id"])
        self.sig_counts[s] += 1
        self.selected.append({**r, "selection_bucket": bucket, "showcase_hint": showcase_hint})
        return True

    def fill_round_robin(self, pool, categories, target, bucket, rng):
        """Distribute picks across categories so no single category dominates."""
        by_cat = {c: [r for r in pool if c in (r.get("categories") or [])] for c in categories}
        uncat = [r for r in pool if not r.get("categories")]
        for v in by_cat.values():
            rng.shuffle(v)
        rng.shuffle(uncat)
        order = list(categories) + ["__uncat__"]
        by_cat["__uncat__"] = uncat
        idx = {c: 0 for c in order}
        n0 = len(self.selected)
        progressed = True
        while len(self.selected) - n0 < target and progressed:
            progressed = False
            for c in order:
                if len(self.selected) - n0 >= target:
                    break
                lst = by_cat[c]
                while idx[c] < len(lst):
                    r = lst[idx[c]]; idx[c] += 1
                    if self.take(r, bucket):
                        progressed = True
                        break
        return len(self.selected) - n0


def main() -> None:
    rng = random.Random(SEED)
    rows = [json.loads(ln) for ln in LABELED.open()]
    categories = list({c for r in rows for c in (r.get("categories") or [])})
    p = Picker(rows)

    def fill_capped(pool, target, bucket):
        got = 0
        for r in pool:
            if got >= target:
                break
            if p.take(r, bucket):
                got += 1
        return got

    # 1. Failures (needs_note=yes).
    for key, (role, target) in FAIL_TARGETS.items():
        pool = [r for r in rows if r.get("role") == role]
        rng.shuffle(pool)
        print(f"failure_{key}: {fill_capped(pool, target, f'failure_{key}')}/{target}")
    sources_pool = [r for r in rows if r.get("role") in SOURCES_ROLES]
    rng.shuffle(sources_pool)
    print(f"failure_sources: {fill_capped(sources_pool, SOURCES_TARGET, 'failure_sources')}/{SOURCES_TARGET}")
    hard_pool = [r for r in rows if (r.get("not_helpful_tag_counts") or {}).get("notHelpfulHardToUnderstand", 0) >= 3]
    rng.shuffle(hard_pool)
    print(f"failure_hard: {fill_capped(hard_pool, HARD_TARGET, 'failure_hard')}/{HARD_TARGET} (pool {len(hard_pool)})")

    # 2. Showcase (needs_note=yes, helpful_reference) — heuristic shortlists; flag confirmed at annotation.
    helpful = [r for r in rows if r.get("role") == "helpful_reference"]
    impact = sorted([r for r in helpful if IMPACT_RE.search(f"{r.get('note_text','')} {r.get('tweet_text','') or ''}")],
                    key=prominence, reverse=True)
    impressive = sorted([r for r in helpful if ({"overhyped_research_or_product", "statistical_or_numerical_claim"}
                         & set(r.get("categories") or [])) and 120 <= len(r.get("note_text", "")) <= 285],
                        key=prominence, reverse=True)
    bridging = sorted([r for r in helpful if "politics_and_policy" in (r.get("categories") or [])],
                      key=prominence, reverse=True)
    for flag, shortlist in (("impact_values_aligned", impact), ("impressive_concise_debunk", impressive),
                            ("bridging_cross_partisan", bridging)):
        got = 0
        for r in shortlist:
            if got >= SHOWCASE_TARGETS[flag]:
                break
            if p.take(r, f"showcase_{flag}", showcase_hint=flag):
                got += 1
        print(f"showcase_{flag}: {got}/{SHOWCASE_TARGETS[flag]} (shortlist {len(shortlist)})")

    # 3. Helpful diversity (needs_note=yes) across categories.
    got = p.fill_round_robin(helpful, categories, HELP_DIVERSITY, "helpful_diversity", rng)
    print(f"helpful_diversity: {got}/{HELP_DIVERSITY}")

    # 4. No-note half across categories.
    no_note = [r for r in rows if r.get("role") == "no_note_needed"]
    got = p.fill_round_robin(no_note, categories, NO_NOTE_TARGET, "no_note", rng)
    print(f"no_note: {got}/{NO_NOTE_TARGET}")

    with OUT.open("w") as f:
        for r in p.selected:
            f.write(json.dumps(r) + "\n")

    nn = Counter(r["needs_note"] for r in p.selected)
    print(f"\nTOTAL selected: {len(p.selected)}")
    print(f"needs_note: {dict(nn)}  ({100*nn['no']/len(p.selected):.0f}% no)")
    cat = Counter(c for r in p.selected for c in (r.get("categories") or ["(uncategorized)"]))
    print("category spread:")
    for c, n in cat.most_common():
        print(f"  {c}: {n}")


if __name__ == "__main__":
    main()
