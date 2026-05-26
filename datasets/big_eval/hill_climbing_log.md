# Hill-climbing log — cheap-bot on val.csv

This is the append-only log for cheap-bot iteration. Each iteration adds a row
to the table and a prose section below. Strategic plan:
`~/.claude/plans/this-was-the-original-elegant-frost.md`.

**Cardinal rules** (from the plan):
- The full 100-row `datasets/big_eval/splits/val.csv` is the truth source.
  Subsets only for fast feedback; never goodheart.
- `datasets/big_eval/splits/test.csv` is sealed until handoff. `tryoutNotes.ts`
  refuses to run on it without `--final`.
- Low false-positive rate matters at least as much as PASS rate.

## Metric definitions

- **PASS / 100** = `note_worthy_correct + non_note_worthy_correct` (rows the AI
  judge marked good + rows where cheap-bot correctly abstained).
- **NW correct** = `note_worthy_correct` (proposed a note on a `needs_note=yes`
  tweet and the judge said the note is good).
- **NW missed** = `note_worthy_not_proposed` (cheap-bot abstained on a
  `needs_note=yes` tweet — a miss).
- **NNW correct** = `non_note_worthy_correct` (cheap-bot abstained on a
  `needs_note=no` tweet — the right call).
- **False-pos rate** = `non_note_worthy_incorrect / 50` (cheap-bot wrote a note
  on a `needs_note=no` tweet — the failure mode the user cares about most).
- **$/row pipeline** = average DeepSeek + searXNG cost across the 100 rows. Does
  NOT include the Opus judge cost, which is constant across iterations.

## Iteration table

| Iter | Variant name | PASS / 100 | Δ vs baseline | NW correct | NW missed | NNW correct | False-pos rate | $/row pipeline | Regressions vs prev | Wins vs prev |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | baseline-cheap-bot-v0 | (pending) | — | — | — | — | — | — | — | — |

## Iteration 0 — baseline

**Run name:** `baseline-cheap-bot-v0`
**Variant matrix:** `--pick bot=cheap-bot` (DeepSeek v4 Flash across query writer, writer, note-needed judge, source verifier; searXNG via local Docker)
**Status:** running in background; numbers will be filled in once complete.

**What this iteration is:** the anchor — no improvements yet. The pipeline is
the bare 5 stages the user specified: one shot of query writing → searXNG fetch
→ writer → note-needed judge → source verifier. Every subsequent iteration is
diffed against this run.

(Diagnosis paragraph + next-step hypothesis go here once the run completes.)
