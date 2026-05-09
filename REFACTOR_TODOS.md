# Refactor TODOs

## Follow-ups from `refactor/error-handling` (PR #129, May 2026)

The error-handling refactor unblocks several cleanups it deliberately
deferred. Context: the PR introduced typed `PipelineError` subclasses,
moved failure-row writes into `recordFailedRun` in `processTweet.ts`,
and shipped investigation scripts in
[`src/scripts_jim/2026_05_09_*`](src/scripts_jim/) that produced concrete
findings. Each item below is intended as its own small PR.

### 1. Per-provider JSON-output fixes (resolved — no code change needed)

The original framing came from
[`scripts_jim/2026_05_09_json_parse_failures/02_test_response_format_strictness.ts`](src/scripts_jim/2026_05_09_json_parse_failures/02_test_response_format_strictness.ts),
a synthetic OpenRouter probe that used `response_format: { type:
"json_object" }` and `max_tokens=200`. Re-investigation in
[`scripts_jim/2026_05_09_sonar_openrouter_probe/`](src/scripts_jim/2026_05_09_sonar_openrouter_probe/)
plus 14 days of production data finds **none of the three sub-issues
need a code fix**:

- **1a (gpt-5 / gpt-5-mini empty content):** the original probe used
  `max_tokens=200`; production uses 4000 with the `web_search_preview`
  tool. Production failure rate over 14 days: 1/4 runs total — sample
  size too small to act on. Re-probing with realistic params shows
  reliable JSON output.
- **1b (sonar errors on `response_format`):** the original probe used
  `{ type: "json_object" }`, which sonar *does* reject — but production
  sends `{ type: "json_schema", json_schema: {...} }`, which sonar
  accepts. `sonar-pro` had 0 failures, `sonar-reasoning-pro` had 1 in
  36 runs (~3%) over 14 days.
- **1c (`gemini-3-pro-preview` errors at the API level):** the
  variant calls the *native* Gemini SDK (`searchWithGeminiNative`),
  not OpenRouter. Production's 100% failure rate is `GEMINI_API_KEY
  environment variable is required but not set` — a GitHub Secret
  configuration issue, not a code issue. The workflow YAML on `main`
  already contains `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}`,
  so the secret itself is missing or named differently. **User action:**
  add a `GEMINI_API_KEY` secret at
  https://github.com/Goodheart-Labs/cn-return-bot/settings/secrets/actions.

**Lesson for future probes:** synthetic JSON-output probes need to
mirror the production parameters exactly. The original probe varied
`response_format` shape and `max_tokens` independently of the actual
call sites and produced false positives on three different
configurations.

If `model_output_invalid` rates climb in the future, re-run the
probes in `scripts_jim/2026_05_09_sonar_openrouter_probe/` to
re-validate.

### 2. Legacy bot cleanup — Migrate the rest to `PipelineOutcome`

**Status:** sub-items 2a (delete retired bots), 2b (unwind try/catch),
and 2c (remove `PipelineResult.lastStage`) shipped in the
`refactor/legacy-bot-cleanup` PR. Remaining work:

> Currently only agent and multi-agent return `PipelineOutcome`. Legacy
> bots (`opus-main`, `opus-bridging`, etc.) still return `PipelineResult`
> directly.
>
> Goal:
> - All bots return `PipelineOutcome`
> - Move `outcomeToResult` mapping into `processSingleTweet` (single
>   place, right before DB storage)
> - Remove `PipelineResult` construction from bot layer entirely

After PR #131 each legacy `runPipeline` is a flat sequence of calls
ending in a `return { post, botId, searchContextResult, noteResult,
checkResult, ... }` literal. The migration is mechanical: replace the
literal with a `PipelineOutcome` (`{type:"note", noteText, sources, ...}`
or `{type:"verification_failed", ...}` etc.) and drop the
`PipelineResult` construction. The orchestrator already calls
`outcomeToResult` for `agent` and `multi-agent`; threading it through
the legacy bots completes the job.

### 3. Source-fetcher: handle HTTP 403 better
**Where:** [`src/pipeline/tool-calling/tools.ts:314`](src/pipeline/tool-calling/tools.ts#L314) (`handleWebFetch`).
**Symptom:** ~16% of cited URLs return 403 because the bot's UA is
blocked (NYT, justice.gov, tennessean.com, war.gov…). These are real
URLs the verifier can't reach. They get bucketed as
`unfetchable_sources` after the refactor — *correct*, but still a
preventable miss.
**Action options (in order of cost):**
- Set a more browser-like `User-Agent` (Chrome desktop UA) instead of
  the current self-identifying string.
- On 403, retry once with a different UA pool.
- Use a headless-browser fetcher for known-difficult domains (NYT etc).

### 4. Pre-deploy A/B variant smoke test in CI
**Why:** the missing `GEMINI_API_KEY` issue cost ~3 days of degraded
candidate rate. The first prod cron after the variant shipped would
have caught it if we'd had a smoke test.
**Where:** new GitHub Actions workflow on PRs touching
[`src/bots/`](src/bots/) or
[`src/pipeline/ab-testing/abTests.ts`](src/pipeline/ab-testing/abTests.ts).
**Action:** run [`src/scripts_jim/2026_05_08_all_variants_smoke/`](src/scripts_jim/2026_05_08_all_variants_smoke/)
against a single test tweet for every variant with `weight > 0`.
Fail the PR if any variant errors.

### 5. Split DB-serialization out of `processTweet.ts`
**Motivation:** [`processTweet.ts`](src/pipeline/orchestration/processTweet.ts)
is ~500 lines doing four jobs: orchestration, scoring, outcome
decision, and DB-row serialization. The file is growing past the
size where one reader can hold it in their head, and the symmetry
between the success-path and failure-path serialization is no longer
visible because they're separated by ~150 lines of unrelated logic.

**Rough fix:** extract a sibling module (e.g.
`src/pipeline/orchestration/pipelineRunCompletion.ts`) holding both
`buildSuccessCompletionData` and `recordFailedRun`, plus the constants
they share (`STACK_FRAMES_TO_KEEP`, `ERROR_MESSAGE_MAX_LEN`). Important:
**move both together** — extracting only `recordFailedRun` is what
this PR avoided, because it would split the success/failure
symmetry across files asymmetrically.

**Places likely affected:**
- [`src/pipeline/orchestration/processTweet.ts`](src/pipeline/orchestration/processTweet.ts) — the source of the move; success and failure paths in `processSingleTweet` get reduced to single function calls.
- New file `src/pipeline/orchestration/pipelineRunCompletion.ts`.
- Possibly `processTweet.ts` exports — `ProcessTweetResult` and `Outcome` types may need to move alongside (or be re-exported from the new file).
- `src/pipeline/utils/tweetLog.ts` re-exports — `getLoggedBotIdentity` and `nestDotKeys` are already shared utilities, so no change needed there.

**What the next agent should investigate:**
1. Whether `Outcome` (the internal struct returned by `determineOutcome`)
   and `ProcessTweetResult` (the public return shape) belong in
   the new file, in `processTweet.ts`, or in a separate `types.ts`.
   Try the move both ways and see which has fewer cross-file imports.
2. Whether the scoring layer (`scorePipelineResult` + its helpers, lines
   ~100–250) should *also* move out into `processTweet/scoring.ts`. If
   yes, the natural shape becomes a `processTweet/` folder rather than
   sibling files. Decide based on whether scoring has callers other
   than `processSingleTweet` (today: probably none, but worth grepping).
3. Whether `determineOutcome` belongs with the orchestrator or with
   serialization. It's a pure function returning the verdict — fine
   either side, but adjacency to `Outcome` type matters.
4. Confirm the catch block in `processSingleTweet` collapses cleanly
   to one `await recordFailedRun(...)` call after the move; if it
   needs more than ~3 lines, the helper's signature is wrong.
