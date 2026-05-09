# Refactor TODOs

## Migrate all bots to PipelineOutcome

Currently only agent and multi-agent return `PipelineOutcome`. Legacy bots (opus-main, opus-bridging, etc.) still return `PipelineResult` directly.

Goal:
- Delete legacy bots
- All bots return `PipelineOutcome`
- Move `outcomeToResult` mapping into `processSingleTweet` (single place, right before DB storage)
- Remove `PipelineResult` construction from bot layer entirely

---

## Follow-ups from `refactor/error-handling` (PR #129, May 2026)

The error-handling refactor unblocks several cleanups it deliberately
deferred. Context: the PR introduced typed `PipelineError` subclasses,
moved failure-row writes into `recordFailedRun` in `processTweet.ts`,
and shipped investigation scripts in
[`src/scripts_jim/2026_05_09_*`](src/scripts_jim/) that produced concrete
findings. Each item below is intended as its own small PR.

### 1. Per-provider JSON-output fixes
**Evidence** (from [`scripts_jim/2026_05_09_json_parse_failures/`](src/scripts_jim/2026_05_09_json_parse_failures/),
specifically `02_test_response_format_strictness.ts`):

#### 1a. `searchWithOpenaiNative` returns empty content
**Affects:** `gpt-5`, `gpt-5-mini`, `kimi-k2.6` — three of fourteen
`simple_bot_search` variants.
**Symptom:** OpenRouter returns `message.content === ""` even with
`response_format: { type: "json_object" }`. Probably the model is
responding via tool calls and we're reading the wrong field.
**Action:** Inspect the raw OpenRouter response shape for these models
and read the right field, OR force tool-choice on a `submit_findings`
tool, OR drop these models if the response shape is unfixable.
**File:** [`src/pipeline/simple-bot/searchDispatch.ts`](src/pipeline/simple-bot/searchDispatch.ts) (`searchWithOpenaiNative` ~line 245).

#### 1b. Perplexity sonar errors on `response_format`
**Affects:** `sonar-pro`, `sonar-reasoning-pro`.
**Symptom:** OpenRouter returns an HTTP error (not just non-JSON
content) when we send `response_format: { type: "json_object" }` for
sonar models. They don't accept that field.
**Action:** Branch the call — drop `response_format` for sonar — and
accept that sonar may emit markdown-fenced JSON. Either parse defensively
in this one place or use the native Perplexity SDK.
**File:** [`searchDispatch.ts:262`](src/pipeline/simple-bot/searchDispatch.ts#L262) (`searchWithSonarBundled`).

#### 1c. `gemini-3-pro-preview` errors at the API level
**Symptom:** Both with and without `response_format`, OpenRouter returns
an error for this exact model ID.
**Action:** Verify the model ID is current with OpenRouter; may have
been renamed. If broken, set the variant's weight to 0 like the
deepseek/qwen ones.

### 2. Legacy bot cleanup
**Goal:** consolidate three loosely-related cleanups in one PR since
they all touch the same 14 files.

#### 2a. Delete truly retired bots
None of these have non-zero weight in any A/B test and no scripts
reference them outside of `bots/index.ts`:
- `opus-4.6`
- `kimi-k2`
- `sonar-pro`
- `opus-concise`
- `opus-verified`

`git rm` the file, remove the import + entry from
[`src/bots/index.ts`](src/bots/index.ts), remove the variant entry from
`BOT_TEST` in `abTests.ts`. ~5 files removed × ~80 lines each.

#### 2b. Unwind the try/catch in remaining legacy bots
The remaining legacy bots (`opus-main`, `opus-main-v2`, `opus-direct`,
`opus-direct-grok`, `opus-main-v2-grok`, `opus-multi-source`,
`opus-bridging`, `opus-main-no-source-check`, `opus-research`) currently
have a try/catch that just rethrows after the error-handling refactor:

```ts
} catch (err: any) {
  console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
  throw err;
}
```

This is dead weight — `processTweet`'s catch already records the
failure. The bot-level `console.error` adds nothing the stack trace
doesn't. **Delete the try/catch entirely**; let exceptions propagate
naturally.

#### 2c. Remove `PipelineResult.lastStage` (write-only)
After the error-handling refactor, nothing reads `result.lastStage`.
Each of the remaining ~9 legacy bots maintains its own `let lastStage =
"started"` / `lastStage = "search"` / etc. — bookkeeping for a field
that's never read.

`final_stage` (the DB column) is now set authoritatively by the
orchestrator. `logs.error.stack` (also set by the orchestrator) tells
you the file/line of any throw. `lastStage` is the misnamed bot-internal
version of `final_stage` from before the orchestrator owned it.

**Action:** remove `lastStage: string` from `PipelineResult` in
[`src/bots/types.ts`](src/bots/types.ts), remove
`lastStage: "complete"` from `outcomeToResult`, remove every
`let lastStage` and assignment + the field in returned results. ~60
lines deleted across the remaining 9 bots.

#### 2d. (Stretch) Migrate the rest to `PipelineOutcome`
This is the original section above. Now that the legacy bots have
nothing in the `catch` block and no `lastStage`, their `runPipeline`
methods are short. Migrating each to `runSimpleBotPipeline`-style
`PipelineOutcome` returns is the natural next step — and lets us
delete `outcomeToResult` from each bot's call site (the orchestrator
becomes the only caller).

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
