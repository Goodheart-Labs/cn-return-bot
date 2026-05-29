# Failure-analysis subagent instructions (cheap-bot iteration)

You are analyzing failures from a `cheap-bot` run on `datasets/big_eval/splits/val.csv`. The goal is to identify **recurring patterns** that would point to concrete fixes — prompt edits, new AB-test variants, or structural changes to the 5-stage pipeline (query writer → searXNG → writer → note-needed judge → source verifier).

## Inputs

You'll get a list of failure rows from one of these categories:
- **`note_worthy_incorrect`** — cheap-bot proposed a note on a `needs_note=yes` tweet, but the AI judge said the note is bad.
- **`note_worthy_not_proposed`** — cheap-bot abstained on a `needs_note=yes` tweet. A miss.
- **`non_note_worthy_incorrect`** — cheap-bot proposed a note on a `needs_note=no` tweet. **A false positive — these are the most important to fix.**

Each row carries:
- `url`, `text` (tweet text), `needs_note`, `ground_truth_note`, `judge_guidance`, `original_note_text`, `failure_reason`
- `note_text` (cheap-bot's proposed note, or empty if it abstained)
- `outcome` (e.g. `rejected (no_correction_needed)`, `failed (unfetchable_sources)`, `candidate`)
- `verdict.reason` (the AI judge's reasoning if a judge ran)
- `logs` — full pipeline log, including stage-by-stage outputs for query writer, search findings, writer, note-needed judge, source verifier

## What to do

For each failure, read enough to understand *why* the pipeline got it wrong. The most important step is to identify which **stage** failed:
- Query writer wrote bad queries → searches missed
- searXNG returned junk → writer had no real evidence
- Writer hallucinated / hedged / missed the key point
- Note-needed judge over-conservative (abstained correctly-noteworthy) or under-conservative (let through a junk note)
- Source verifier rejected a valid source / accepted a bad one

Then group rows by pattern. Don't be exhaustive — surface the **3-5 dominant patterns** with frequency counts and one specific fix per pattern.

## Output

Reply with a structured report. For each pattern:

```
### Pattern <N>: <short name>  (<count> rows)

**What's happening:** 1-2 sentences describing the failure pattern. Cite 2-3 specific
example tweet_ids (e.g. "Iran cluster bomb tweet 2029667760557432837").

**Which stage:** query_writer | searxng | writer | note_needed_judge | source_verifier

**Concrete fix suggestion:** what would I change to fix this? Be specific:
- "Tighten the query-writer prompt to require quoted phrases from the tweet" (prompt edit)
- "Add a paywall-snippet fallback to source verifier for Lead Stories / AFP / etc." (structural)
- "Try writer with `temperature: 0.3` instead of default" (new AB variant)

**Confidence:** high / medium / low — how sure are you this is the right diagnosis?
```

At the bottom, a one-line **priority recommendation**: which pattern to fix first and why.

## Constraints

- Don't read the cached input files in `datasets/big_eval/inputs/<tweet_id>.json`
  — the per-row JSON from the run already carries everything you need
  (tweet text, original note, judge guidance, the full pipeline log). Loading
  the inputs ballons your context and rarely changes the diagnosis.
- Don't propose more than 5 patterns. If there's no fifth, return 3 or 4.
- Don't pre-suppose a pattern. If the failures are heterogeneous, say so —
  "I can't find a dominant pattern, the failures look one-off" is a valid
  report.
- Keep the total response under 600 words.
