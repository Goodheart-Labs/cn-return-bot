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
| 0 | baseline-cheap-bot-v0 | 49 | — | 4 | 40 | 45 | 10% (5/50) | — | — | — |

## Iteration 0 — baseline

**Run name:** `baseline-cheap-bot-v0`
**Run folder:** `dataset_runs/tryout-baseline-cheap-bot-v0-2026-05-26-1937`
**Variant matrix:** `--pick bot=cheap-bot` (DeepSeek v4 Flash across query writer, writer, note-needed judge, source verifier; searXNG via local Docker on port 8080)
**Status:** complete (100/100 processed, 0 errors).

### Headline numbers

- **PASS:** 49/100 (49%)
- **Noteworthy (50 tweets, `needs_note=yes`):**
  - Correct: 4 (8%)
  - Incorrect (note proposed but judge said bad): 6 (12%)
  - Not proposed (missed entirely): 40 (80%)
- **Non-noteworthy (50 tweets, `needs_note=no`):**
  - Correct (abstained correctly): 45 (90%)
  - Incorrect (false positive — proposed a note we shouldn't have): 5 (10%)

### Read of the baseline

cheap-bot is heavily skewed toward abstaining. It correctly abstains on
non-noteworthy tweets 90% of the time — the note-needed judge + source
verifier are doing their job as FP guards. But the same conservatism produces
a brutal 80% miss rate on tweets that genuinely need a note.

The dominant failure pattern (by count) is `note_worthy_not_proposed` — 40
of the 100 rows. To hit a meaningful PASS rate above 50%, we have to
get the bot to actually propose notes more often *without* exploding the FP
rate. The 10% FP rate is acceptable but not great; we want it lower if
possible, certainly not higher.

The 6 `note_worthy_incorrect` rows are also worth diagnosing — these are
cases where the bot DID propose a note but it was wrong. Likely query-writer
or writer-stage issues.

### Next step

Diagnosis subagents (using `failure_analysis_instructions.md`) over the
40 `note_worthy_not_proposed` rows + the 6 `note_worthy_incorrect` rows +
the 5 `non_note_worthy_incorrect` rows. Deferred to next session — this
session is hitting its $40 budget cap. The data is durable in the run folder,
the scaffolding is in place, the next session can pick up directly from
the failure JSONs at
`dataset_runs/tryout-baseline-cheap-bot-v0-2026-05-26-1937/`.
