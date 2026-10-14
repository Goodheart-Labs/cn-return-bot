# Do the context quotes of different claims overlap, and does it matter?

Jim's question: is text that belongs to two or more claims a legitimate and important case, or can the extractor cut a post into non-overlapping passages, with several claims allowed per passage?

This folder answers it from the production database (read only, 2026-10-08).

## How to run

```bash
uv run src/scripts_jim/2026_10_08_overlapping_claim_passages/analyse.py
```

`fetch.py` downloads the claims, notes and item texts with keyset pagination and small pages, and keeps them in `cache/` (ignored by git), so a rerun takes about a minute. `analyse.py` writes `results.json` (all numbers below) and `samples.md` (random pairs for reading, seed 20261008: 15 PARTIAL, 15 NESTED, 10 IDENTICAL).

## What was measured

Only extractor claims count (`judgement` is not `user`). That is 133,388 claims in 1,647 items. Of these, 7,971 (6.0%) have no `context_quote` because they rest on an image, so 125,417 claims were analysed. The 26 reader-added claims were left out.

Each `context_quote` was looked up in its item's `full_text` to get a character interval. First an exact substring match was tried, then a match on the first and last 8 words that ignores case, punctuation and spacing. Two claims of the same item are a pair when their intervals share at least one character, and the pair is:

- IDENTICAL when the intervals are the same.
- NESTED when one lies inside the other (they may share one edge).
- PARTIAL when they overlap and neither is inside the other.

### Placing the quotes

| Result | Claims | Share |
|---|---|---|
| Exact substring | 49,637 | 39.6% |
| Same words, different line breaks or spacing | 74,088 | 59.1% |
| First and last 8 words only (quote drifted from the text) | 640 | 0.5% |
| Not placed, excluded | 1,052 | 0.8% |

Most exact misses are YouTube transcripts, where the stored text has a line break every few words and the quote has spaces instead. The 1,052 failures include 5 items whose `full_text` is empty.

## Findings

### Pairs of claims whose quotes overlap

| Class | Pairs | Claims taking part | Share of the 124,365 placed claims |
|---|---|---|---|
| IDENTICAL | 3,219 | 5,132 | 4.1% |
| NESTED | 8,798 | 15,325 | 12.3% |
| PARTIAL | 6,337 | 9,833 | 7.9% |
| Any overlap | 18,354 | 27,210 | 21.9% |

A claim can sit in several classes. Giving each claim the most awkward class it takes part in (PARTIAL, then NESTED, then IDENTICAL) gives: no overlap 97,155 claims (78.1%), IDENTICAL only 4,364 (3.5%), NESTED 13,013 (10.5%), PARTIAL 9,833 (7.9%).

When the quotes of one item are laid over its text, 61.5% of the characters are in no quote, 34.7% in exactly one, 3.4% in two and 0.5% in three or more. So overlap exists, but it touches only a few percent of the text. Where two quotes overlap, the shared part is the whole inner quote for NESTED pairs (median 100% of the shorter quote) and about half of the shorter quote for PARTIAL pairs (median 53%).

### Context paragraphs

The wider `context_paragraph` windows overlap far more: 72% of claims share their paragraph with another claim, 40% sit in an identical paragraph with at least one other claim (50,186 identical pairs, 12,519 nested, 34,852 partial), and only 44.8% of the text is outside every paragraph. This is expected. A paragraph is the setting for every claim in it, and nobody needs these to be disjoint.

### Does the overlap carry information? (from reading the 40 samples)

- **IDENTICAL: legitimate and harmless.** All ten samples are one sentence that holds two or three separate facts ("Lighthaven is open, METR is hiring", "I have three kids, and my oldest kid is seven"). This is exactly the case "several claims in one passage". The new format covers it as is.
- **NESTED: almost always an artifact of the "enough surrounding sentences" instruction.** In most samples both claims come from one sentence or from two neighbouring sentences, and the extractor gave one claim a window of one sentence and the other a window of two. Examples: "Bo Nix is a third-year quarterback" has the quote "great answer by the thirdyear quarterback Bo Nicks." while "Bo Nix threw a touchdown pass to Engram" has the same plus the sentence before it. A few cases have a real dependency (the claim about a "high-profile unpopular G.O.P. policy commitment" needs the sentence before it to make sense), but the neighbouring sentence is then in the same cluster anyway. The one real cost is precision: in a nested pair with a small inner quote and a 400-character outer quote, one passage would highlight more text than the small claim needs.
- **PARTIAL: the same artifact, two sliding windows.** Each claim's window runs from its own sentence into a neighbour, and two adjacent claims share one sentence. In none of the 15 samples did two claims need different, interleaved pieces of text that a single merged passage could not serve. Typical overlaps are one or two sentences.

### How big would a non-overlapping tiling be?

If every group of overlapping quotes is simply merged into one passage, the 124,365 claims fall into 108,597 passages. Median passage: 121 characters and 1 claim. 90th percentile: 241 characters and 2 claims. 99th percentile: 421 characters. Largest: 2,035 characters and 21 claims. So merging never produces a runaway passage.

### Importance: notes and fact-checks

A claim is fact-checked when its rating is `uncertain` or worse (uncertain, somewhat likely false, likely false, certainly false).

| Overlap class of the claim | Claims | With a note | Fact-checked |
|---|---|---|---|
| None | 97,155 | 1,339 (1.38%) | 20,352 (20.9%) |
| IDENTICAL only | 4,364 | 58 (1.33%) | 1,187 (27.2%) |
| NESTED | 13,013 | 196 (1.51%) | 2,627 (20.2%) |
| PARTIAL | 9,833 | 175 (1.78%) | 1,765 (17.9%) |

Overlapping claims are neither more nor less likely to get a note or a check than other claims. About 22% of all claims and 24% of claims with notes take part in an overlap, so overlapping claims are an ordinary part of the output, not a special group. Almost all notes are AI notes (only 3 reader notes sit on the claims analysed).

## Recommendation

Overlap between claim quotes is common (22% of claims) but not important in itself. IDENTICAL overlap is real and legitimate and the new format keeps it by allowing several claims per passage. NESTED and PARTIAL overlap are, in the samples, side effects of giving each claim its own sliding window of neighbouring sentences. Cutting the text into non-overlapping passages with several claims per passage looks safe: merging overlapping quotes gives small passages (median 121 characters, 99% under 421), and the notes and fact-check rates of overlapping claims match the rest.

What the tiling does cost is highlight precision for nested pairs, where a short claim would now point at the longer passage. If that matters, the cut points should be chosen by the extractor so that a passage is a sentence or two, not a paragraph.

## Uncertainties

- Items may have been re-fetched after the claims were extracted. The 0.8% of quotes that could not be placed are mostly such cases or empty item texts, and they are excluded, so overlaps involving them are not counted.
- A quote that appears twice in an item is placed at its first occurrence. For quotes of 8 or more words this should be rare, but in repetitive transcripts it can happen.
- The 640 quotes placed by their first and last 8 words only (0.5%) may have slightly wrong edges.
- The legitimacy judgement comes from reading 40 random pairs, not all 18,354. It is a judgement, not a measurement.
- Notes are counted per claim. A claim with a note is a claim with at least one `everything_notes` row, whatever its status.
- The rating scale was read from the data: certainly true, likely true, somewhat likely true, uncertain, somewhat likely false, likely false, certainly false. Whether a claim was really fact-checked was not read from the pipeline run log, only inferred from the rating.
