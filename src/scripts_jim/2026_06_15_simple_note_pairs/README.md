# Simple-note pairs

Dataset of cases where **our note was NOT rated helpful but a different note on
the same tweet WAS rated helpful**, each labelled by *why the other note won*.

## Question

When the community picked someone else's note over ours, was it because the
other note was **simpler / better written**, because it had **better content**
(ours was wrong, theirs had better sources), or were they **basically the same**
(we just got fewer ratings)?

## Pipeline

1. `01_build_pairs.py` — every submitted note of ours with `cn_status !=
   CURRENTLY_RATED_HELPFUL` that shares a tweet with a helpful `competing_notes`
   row. One helpful competitor per tweet (earliest = most canonical). →
   `pairs.json` (552 pairs).
2. `02_make_batches.py` — split into `batches/batch_NN.json` (28 pairs each).
3. **Claude Sonnet subagents** — one per batch — read a batch and write
   `batch_NN.out.json` with `{our_note_id, category, reason}` per pair.
   (`batch_99` is a single-pair re-run for one note an agent mis-transcribed.)
4. `03_assemble.py` — merge verdicts back onto the full pairs, validate that
   every pair is classified exactly once, and split into the three deliverables.

## Categories

- `similar` — comparable quality; ours likely just got fewer ratings.
- `other_simpler` — the helpful note wins on **form** (simpler / clearer / more
  direct / better written / shorter); substance comparable. ← the "simple and
  nice" set.
- `other_better_content` — the helpful note wins on **substance** (ours
  false / off-target, or theirs has better sources / a more correct point).

## Results (552 pairs)

| category | count |
|---|---|
| other_better_content | 280 |
| similar | 137 |
| other_simpler | 135 |

Notable: all **24** of our notes that were actively rated
`CURRENTLY_RATED_NOT_HELPFUL` fall under `other_better_content`. When our note
was downvoted (not merely ignored) it was always a content problem — never just
"less simple." `other_simpler` and `similar` are entirely `NEEDS_MORE_RATINGS`.

## Deliverables

`similar.json`, `other_simpler.json`, `other_better_content.json` —
each a list of full pairs (tweet text, both note texts, ids, status) plus the
Sonnet `category` and `reason`. `classified.json` is all three combined.
