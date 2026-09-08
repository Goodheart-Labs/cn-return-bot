# Is Muse callable with our OpenRouter key yet? (GOO-124)

Two runs, both asking whether the block found during the model evaluation
(GOO-95, PR #439) has been lifted.

- **2026-09-07:** no. Still stopped at OpenRouter's 18+ age confirmation.
- **2026-09-08, after the age box was ticked:** both OpenRouter gates are now
  clear. **The writer arm works. The search arm does not, for a new and
  unrelated reason: Meta's own API refuses the `tool_choice` value our search
  loop sends on its first turn.**

## What the gates were

OpenRouter is the broker we send almost every model call through. It refuses
some models until the *account* has ticked a box, and it calls those boxes
**attestations** — a statement the account holder makes about themselves, such
as being over 18. It calls the filters that act on account-wide policy
**guardrails** — for example, a rule that this account may not use providers who
train on the prompts we send them.

The two are checked at different points in a fixed order, and OpenRouter names
the point that failed in the error body under `failed_routing_step`. That
ordering is why gate 2 was invisible while gate 1 was unsolved.

Both are now cleared. Gate 1 was cleared by ticking 18+ at
https://openrouter.ai/settings/preferences. Gate 2, the training-data
permission, never fired at all once gate 1 was open, so no guardrail is standing
between this account and Meta's contributor tier.

## Where Muse stands today

Run as
`bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts --only muse`.
The `--only` flag was added for this re-test. The script imports the pipeline's
real client and its real response formats, so these are the exact requests
production would send.

| Model | Request shape | 2026-09-07 | 2026-09-08 |
|---|---|---|---|
| meta/muse-spark-1.3-contributor | Advertised parameter support (free) | Pass | Pass |
| meta/muse-spark-1.3-contributor | Writer, strict `json_schema` | 403, age gate | **Pass**, parsed cleanly, $0.000135 |
| meta/muse-spark-1.3-contributor | Search, tools forced (`tool_choice: "required"`) | 403, age gate | **Fail, 400 from Meta** |
| meta/muse-spark-1.3-contributor | Search, tools plus `json_schema` (`tool_choice: "auto"`) | 403, age gate | **Pass**, chose a tool call |

So the writer arm `musespark13c` is fully verified and could ship today. The
search arm `musespark13c-serper` cannot, because of the one failing row.

## The new blocker, in detail

Meta's API rejects the request outright:

```json
{
  "message": "Provider returned error", "code": 400,
  "metadata": {
    "provider_name": "Meta",
    "raw": "{\"error\":{\"message\":\"only `\\\"auto\\\"` is supported for `tool_choice`. `\\\"none\\\"`, `\\\"required\\\"`, and named function choices are not currently supported\",\"param\":\"tool_choice\",\"type\":\"invalid_request_error\"}}"
  }
}
```

`tool_choice` is the OpenAI-style request field that says how hard the model is
pushed to call a tool. `"auto"` lets the model decide, `"required"` obliges it
to call one. Meta supports only `"auto"`.

**This is where our search loop breaks.** `searchWithSerperLoop` in
`src/pipeline/simple-bot/searchDispatch.ts:409` sends `tool_choice: "required"`
on turn 1 and `"auto"` from turn 2 onwards. So every single run of the
`musespark13c-serper` arm would die on its first call. The comment there records
why turn 1 is forced: without it, some models answer straight from the JSON
schema with empty findings and `correction_needed: false`, never searching at
all, which DeepSeek v4 Flash did on 2026-05-23.

Three further facts about it:

**It is Meta-wide, not a property of the cheap tier.** `meta/muse-spark-1.3`,
the standard tier at $1.25/$4.25, returns the identical error. Paying twelve
times more would not buy the parameter.

**The free pre-check cannot catch this.** OpenRouter's model list advertises
`tool_choice` as supported for Muse, so `provider: { require_parameters: true }`
happily routed the request, and the script's cheap "advertised parameters" check
passes. The advertisement covers the field, not the values the provider accepts.
That is a general lesson for this script: a green on the free check is weaker
evidence than it looks.

**`"auto"` alone appears to be enough for Muse.** The obvious fix is to stop
forcing turn 1 for this model, and the risk is the failure mode the forcing was
added to prevent. `probeToolChoice.ts` in this folder sends the loop's real
turn-1 shape with `"auto"` and counts how often Muse searches anyway. It called
`google_search` on **5 of 5 samples**, usually twice, for $0.0003 in total. That
is a small sample on one claim, so it is encouraging rather than conclusive.

## Cost of finding all this out

$0.000437 across both days. The 2026-09-07 run cost $0.000023, the verification
re-run $0.000135, and the five `tool_choice` samples $0.000302. Every rejected
call was free, because it never reached a provider.

## Is Spark 1.3 still the latest Muse?

Yes. OpenRouter's live model list has seven `meta/muse-` entries and the one we
declared is the newest and the cheapest:

| Model | Added to OpenRouter | In/Out $/M | Context |
|---|---|---|---|
| meta/muse-spark-1.3-contributor | 2026-09-02 20:38 UTC | 0.10 / 0.20 | 1,048,576 |
| meta/muse-spark-1.3 | 2026-09-02 19:45 UTC | 1.25 / 4.25 | 1,048,576 |
| meta/muse-spark-1.2-contributor | 2026-08-21 18:21 UTC | 0.10 / 0.20 | 1,048,576 |
| meta/muse-glimmer-30b | 2026-08-09 19:06 UTC | 0.30 / 1.10 | 131,072 |
| meta/muse-glimmer-30b:batch | 2026-08-09 19:06 UTC | 0.35 / 1.50 | 131,072 |
| meta/muse-spark-1.2 | 2026-08-05 19:48 UTC | 1.25 / 4.25 | 1,048,576 |
| meta/muse-spark-1.1 | 2026-07-16 15:29 UTC | 1.25 / 4.25 | 1,048,576 |

Nothing newer than Spark 1.3 exists and nothing is cheaper than the contributor
tier, so the arm we declared is still the right target. Muse Glimmer 30B was
probed on 2026-09-07 only to work out how wide the age gate was; it is older, a
small 30B model rather than the frontier Spark line, has an eight-times-shorter
context and costs three times more per input token, so it is not a candidate.

## The production key in the shared `.env` is still dead

Unrelated to Muse, unchanged between the two runs, and worth its own line. The
`OPENROUTER_API_KEY` in `~/dev/env/cn-return-bot/env`, which every worktree
symlinks as its `.env`, is rejected at the account level:

```
GET https://openrouter.ai/api/v1/key
401 {"error":{"message":"User not found.","code":401}}
```

A 401 there means the key does not resolve to an account at all, so it has been
revoked or replaced. Everything above therefore runs on
`OPENROUTER_TESTING_KEY`, not on the production key.

**Production itself is fine.** GitHub Actions holds its own copy of the key as a
repository secret and that copy works: `Create Notes Routine` and `Everything
Priority Feeds` were green through 19:48 and 20:03 UTC on 2026-09-07, and
production recorded 231 pipeline runs costing $15.00 in the six hours to 19:58
UTC that day. Only local work is broken, and it stays broken until the file is
refreshed.

This does leave one real gap. The age confirmation is an **account** setting, so
whether the production account has it depends on which OpenRouter account the
repository secret belongs to. If it is the same account as the testing key, the
results above carry over. If it is a different one, the age box may still need
ticking there. Refreshing the local key file would settle it in one command.

## What it actually costs per run

The case for Muse rested on list price, where the contributor tier is about a
fiftieth of Sonnet's. A real run is not that, because Muse emits reasoning
tokens. Three claims through the full search loop, same claims for each model:

| Model | Cost per run | Time per run |
|---|---|---|
| meta/muse-spark-1.3-contributor | $0.000695 | 15.1s |
| z-ai/glm-5.3-flash | $0.000366 | 65.0s |
| moonshotai/kimi-k3 | $0.015480 | 8.9s |

So Muse is **not** the cheapest search arm we have. GLM 5.3 Flash does the same
work for about half the money, though it takes four times as long. What Muse is,
is roughly **22 times cheaper than Kimi K3**, which is a live arm today at the
same kind of weight. Against the mainstream arms the saving is large and real;
against the other cheap arm it is not a saving at all.

Three claims is a small sample and this says nothing about quality, which is the
thing the A/B test exists to measure. It is here only so the cost claim in
PR #439 is not carried forward unexamined.

## What shipped

Jim's decisions on 2026-09-08:

**The search loop now falls back.** When a provider rejects
`tool_choice: "required"`, that turn is retried once without the forced tool
call, with the response format attached as an unforced turn would have it. The
matching is on the provider's error body rather than on a model name, so the
next provider with this restriction is covered without another change. A
provider that accepts `"required"` never reaches the fallback, so no other arm
changes behaviour.

**The client no longer retries a rejected request.** `isRetryableError` in
`llm.ts` used to treat every provider 400 as worth another attempt, so this
error was retried four times over seven seconds of backoff before surfacing. A
provider that calls a request invalid will say so again, so those now fail on
the first attempt. Both behaviours are pinned by `searchToolChoice.test.ts`
against the verbatim error body.

**Both Muse arms are live.** `musespark13c-serper` at weight 4, which is 4 of 32
and about 12.5% of searches. `musespark13c` at weight 10, which is 10 of 110 and
about 9.1% of writes; Sonnet and Gemini Flash keep their 50/50 relationship to
each other and simply accumulate data 9% more slowly.

Verified end to end: the real `dispatchSearch` against real Serper traffic
completed the whole loop on Muse in 14.3s and returned a correct, sourced
answer. `z-ai/glm-5.3-flash` was run as a control and is unaffected.

## Still open

The production key question. Jim's judgement is that the 18+ box was ticked on
the same OpenRouter account the bot runs on, so production is covered. That is
an assumption rather than something measured, because the local copy of the
production key is dead and could not be used to check. If Muse arms start
failing in production with a 403 naming an age confirmation, this is why.
