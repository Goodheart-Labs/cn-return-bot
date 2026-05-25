# big_eval dataset build

Builds a ~500-row, richly-annotated Community-Notes eval dataset for hill-climbing.
Plan: `~/.claude/plans/hi-claude-i-have-memoized-waffle.md`. Outputs live in `datasets/big_eval/`.

Annotation + fact-check + categorization are done by **Claude Code (Opus 4.7) via subagents** on the
agent token budget — so the build burns the rolling 5-hour usage window and must stop with headroom
and auto-resume. Everything is checkpointed to flat files; every unit is an idempotent file.

## Usage watcher (run this whenever building)

No admin key exists and the Admin Usage API wouldn't see Claude Code subscription usage, so we read
usage from local transcripts via `ccusage`. Signal = **cost of the active 5h block** (raw token
totals are ~90% cheap cache-reads). It writes `datasets/big_eval/PAUSE` at ≥75% of a cost ceiling and
clears it after the window resets.

```bash
# background, while building:
uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py --interval 120
# one-shot check (used by the resume routine at startup):
uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py --once
```

Ceiling defaults to the historical max completed-block cost (auto). Override to stop earlier:
`USAGE_BLOCK_COST_LIMIT=80 uv run .../usage_watch.py ...`.

The annotation orchestrator checks `datasets/big_eval/PAUSE` before each batch; if present it
checkpoints and stops.

## Phases

```bash
# 1. corpus + availability (notes/status fast; ratings streams ~40GB)
uv run src/scripts_jim/2026_05_25_big_eval_dataset/01_build_corpus.py notes
uv run src/scripts_jim/2026_05_25_big_eval_dataset/01_build_corpus.py ratings
uv run src/scripts_jim/2026_05_25_big_eval_dataset/01_build_corpus.py db
uv run src/scripts_jim/2026_05_25_big_eval_dataset/01_build_corpus.py merge
# 2. survey corpus -> propose CATEGORIES.md  (Claude + subagents; USER APPROVES taxonomy+counts)
# 3. classify corpus into approved categories -> corpus_labeled.jsonl
# 4. select ~500 (50/50 needs_note) -> selected.jsonl     (03_select.py)
# 5. pre-cache tweet inputs -> inputs/<id>.json           (04_cache_inputs.ts)
# 6. annotate + fact-check via subagents -> annotations/<id>.json   (gated on PAUSE)
# 7. assemble -> dataset.jsonl + splits + report.md       (05_assemble.py)
# 8. extend judgeRow to consume judge_guidance + original note
```

`progress.json` tracks the current phase and per-unit done/pending. Re-running any phase skips
finished units.

## Resume after a usage reset (continuation prompt)

Set up a **desktop local scheduled task** (preferred — separate quota tier, machine must stay on) or
an **hourly cloud routine** with this self-contained prompt:

> Continue the big_eval dataset build. Read `datasets/big_eval/progress.json`,
> `src/scripts_jim/2026_05_25_big_eval_dataset/README.md`, and (once it exists)
> `datasets/big_eval/CATEGORIES.md`. First run `usage_watch.py --once`; if `datasets/big_eval/PAUSE`
> exists, stop. Otherwise resume the next pending phase/units, dispatching annotation subagents in
> bounded batches (~8–12 datapoints, a few parallel), and after each batch re-check `PAUSE`. Stop
> cleanly after the per-run cap or when `PAUSE` appears; update `progress.json`.

Branch: `feature/big-eval-dataset`. For the cloud routine, commit `progress.json` + new
`annotations/*.json` each run so the next clone resumes.
