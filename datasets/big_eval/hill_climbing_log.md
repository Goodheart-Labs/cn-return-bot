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
| 1 | iter1 | 46 | −3 | 5 | 32 | 41 | 18% (9/50) | — | 11 | 8 |

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

### Diagnosis (4 parallel Sonnet subagents over 51 failure rows)

Dispatched via [`09_prep_failure_batches.py`](../../src/scripts_jim/2026_05_25_big_eval_dataset/09_prep_failure_batches.py) + [`failure_analysis_instructions.md`](../../src/scripts_jim/2026_05_25_big_eval_dataset/failure_analysis_instructions.md). Trimmed per-row JSONs went into `_failure_batches/` under the run folder.

**Big surprise:** searXNG appears to have been **rate-limited mid-run**. Batches
`missed_1` and `missed_2` (26 rows) show "No results" on all 3 queries in
21 of 26 rows. Batch `missed_0` (14 rows) only had 1 zero-result row. The
smoke test before the run produced real results. Likely: Docker searXNG +
Google engine hit a rate limit partway through the 100-row run.

**Three real pipeline failures independent of search:**

1. **Source verifier over-rejection** (~7 rows). Blocks valid notes citing
   stable authority sources — AFP, Snopes, Reuters, FDA, BLS, UEFA, NPR —
   because the live fetch returns 4xx / times out. The note-needed judge
   approved these same notes on the same evidence. Fix: allowlist for
   canonical authority domains (skip live fetch), or treat
   "trusted-domain-unfetchable" as accepted-with-warning instead of rejected.

2. **Writer hallucinates when search returns nothing** (3+ rows). With no
   findings, writer fabricates plausible-sounding notes ("a local Quebec
   resident publicly stated…") and cites the tweet's own URL as a source.
   Fix: writer guard — if findings empty, return no_correction instead.

3. **Note-needed judge has two opposite calibration issues.** Over-permissive
   on satire / predictions / editorial framing (all 5 FPs fall here — judge
   treats "some commenters take it as real" as sufficient). Over-conservative
   on absence-of-evidence cases (fabricated quotes, non-events): demands a
   primary source disconfirming the non-event, which by definition doesn't
   exist.

Full subagent reports preserved in the transcript and at
`dataset_runs/tryout-baseline-cheap-bot-v0-2026-05-26-1937/_failure_batches/`.

## Iteration 1 — fixes from baseline diagnosis

**Run name:** `iter1` · folder: `dataset_runs/tryout-iter1-2026-05-26-2237/`
**Changes (one commit):**
1. searXNG multi-engine (google + bing + duckduckgo + brave) + retry+backoff in `fetchSearxngResults`
2. Writer no-findings guard in `cheap-bot/orchestrator.ts` (skip writer if totalResults === 0)
3. Note-needed judge prompt loosened on fabricated-quote/non-event absence-of-evidence; tightened on predictions/satire-with-overwhelming-jokes
4. webFetch reliability — desktop UA → mobile UA on 4xx → Wayback Machine fallback

### Headline numbers

- **PASS: 46/100 (−3 vs baseline)** — REGRESSION on PASS rate
- **False-pos rate: 18% (9/50) (vs 10% baseline)** — REGRESSION, doubled FP rate
- NW correct: 5 (+1), NW missed: 32 (−8), NNW correct: 41 (−4)

The fixes succeeded at getting the bot to propose more notes (misses 40 → 32), but
many of the new notes are bad (FP 5 → 9, incorrect 6 → 13). The judge-prompt
loosening was too aggressive.

### Diagnosis (4 parallel Sonnet subagents, 54 failure rows)

**Major new finding — searXNG locale issue.** Three of four agents independently
flagged that searXNG (with the new multi-engine fan-out) is returning
German-language results. dict.leo.org, Linguee, German Wikipedia, McDonald's
Germany, Speedtest pages instead of English news. This wasn't in baseline
(Google-only). Probably one of the engines I enabled (DuckDuckGo / Brave) is
defaulting to a German locale.

The German-results issue explains the bulk of remaining problems: the
no-findings guard doesn't fire (results > 0), the writer hallucinates from
parametric memory or cites the tweet's own URL, the judge approves notes
based on weak evidence.

**Other patterns:**
- Judge prompt over-loosening — the fabricated-quote / non-event clause
  triggered on satire/parody posts that already contain corrective context
  (attached real video, credited parody creator, roleplay bio). 6 of the 9 FPs
  share this pattern.
- Writer not requiring URLs from search findings — 5 misses had a substantively
  correct note but cited empty / self-tweet / Instagram-only sources, which
  the source verifier rightly rejected.
- Writer ignoring retraction signals (Barbacid PNAS retraction visible in
  search snippet but writer restated the finding as established fact).
- Writer not addressing all claims in multi-claim tweets (5 incorrects had
  a directionally-correct note that missed a secondary false claim).

### Proposed iteration 2 (awaiting user approval)

Three changes in one commit, after a 5-minute hand-verification of the German-
results hypothesis with curl:

1. **searXNG locale fix.** Confirm via curl whether the locale parameter
   (`language=en`) on the multi-engine query makes results English. If not,
   identify which engine is leaking German results and either disable it or
   force its locale. Possibly switch from "engines=google,bing,duckduckgo,brave"
   back to "engines=google,bing" if locale isolation isn't viable.

2. **Tighten judge on source-signaled satire.** Roll back the fabricated-quote
   clause for tweets where the tweet itself contains the corrective context
   (attached video, credited parody creator, roleplay bio in author info,
   self-debunking caption like "NOTHING on this page is REAL"). Keep the clause
   for fabricated quotes attributed to real public figures with no in-tweet
   disambiguation.

3. **Writer source-grounding requirement.** Writer prompt must require at least
   one URL from the search findings. Block empty sources, self-citation of the
   tweet's URL, and Instagram/TikTok-only sources (require ≥1 news outlet or
   Wikipedia link). Five rows in iter-1 would have passed without this.

Expected: PASS climbs to ~55-60 (real evidence finally reaching the writer),
FP rate drops back toward ~10% (satire tightening reverses iter-1 FP regression),
cost roughly flat.

### Original (now-stale) iteration 1 proposal text follows for the record

### Proposed iteration 1 (NOW DONE — implemented as above)

Three changes in one commit, then re-run val.csv:

1. **Investigate + fix the searXNG rate-limit issue.** Hand-test a few
   zero-result queries to confirm rate-limiting. If confirmed, add per-query
   backoff + a fallback engine (Bing / DuckDuckGo) in the searXNG settings.

2. **No-findings writer guard.** If cumulative searXNG findings are
   suspiciously empty (e.g., < ~200 chars across all queries), the orchestrator
   short-circuits to `no_correction` with reason `no_evidence_found`. Stops
   the writer from hallucinating.

3. **Judge prompt clauses.** Add explicit handling for predictions / satire /
   editorial framing (return false) and for fabricated-quote / non-event
   claims where absence-of-evidence is the evidence (return true).

Expected: PASS 49 → ~60, FP rate 10% → ~5%, cost roughly flat.
