# Is Muse callable with our OpenRouter key yet? (GOO-124)

Re-test on 2026-09-07, asking whether the block found on 2026-09-04 during the
model evaluation (GOO-95, PR #439) has been lifted.

**Short answer: no. Muse is still stopped at the first of OpenRouter's two
gates, the 18+ age confirmation. Nobody has clicked it yet.**

## What "gate" means here

OpenRouter is the broker we send almost every model call through. It refuses
some models until the *account* has ticked a box, and it calls those boxes
**attestations** — a statement the account holder makes about themselves, such
as being over 18. It calls the filters that act on account-wide policy
**guardrails** — for example, a rule that this account may not use providers
who train on the prompts we send them.

Attestations and guardrails are checked at different points, in a fixed order,
and OpenRouter names the point that failed in the error body under
`failed_routing_step`. That ordering is why the second gate is invisible until
the first one is cleared, and it is how you tell the two states apart.

## The result, per model and per request shape

The check is `verifyModels.ts` in `src/scripts_jim/2026_09_01_model_evaluation/`,
run as `bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts --only muse`.
The `--only` flag was added for this re-test. It imports the pipeline's real
client and its real response formats, so the three shapes below are the exact
requests production would send.

| Key | Model | Request shape | Result |
|---|---|---|---|
| Testing (`OPENROUTER_TESTING_KEY`) | meta/muse-spark-1.3-contributor | Advertised parameter support (free) | Pass, has `response_format`, `structured_outputs`, `tools`, `tool_choice`, $0.10/$0.20 |
| Testing | meta/muse-spark-1.3-contributor | Writer, strict `json_schema` | **403, gate 1** |
| Testing | meta/muse-spark-1.3-contributor | Search, tools forced | **403, gate 1** |
| Testing | meta/muse-spark-1.3-contributor | Search, tools plus `json_schema` | **403, gate 1** |
| Testing | meta/muse-spark-1.3 (standard tier) | Bare call | **403, gate 1** |
| Testing | meta/muse-spark-1.2-contributor | Bare call | **403, gate 1** |
| Testing | meta/muse-glimmer-30b | Bare call | Pass, answered from DeepInfra, $0.000023 |
| Production (`OPENROUTER_API_KEY` in the shared `.env`) | every Muse model | every shape | **Could not test, the key is dead. See below.** |

The whole probe cost $0.000023, which is the one Glimmer call. Every other
attempt was rejected before it reached a provider, so it was free.

The 403 body is identical across all three Muse Spark models and all three
request shapes:

```json
{
  "error": {
    "message": "This model requires you to complete the following before use: 18+ age confirmation. Confirm at https://openrouter.ai/settings/preferences.",
    "code": 403,
    "metadata": {
      "missing_attestation_types": ["age_18plus"],
      "routing_funnel": [{ "step": "Initial Endpoints", "endpoint_count": 1 }],
      "failed_routing_step": "Gate Endpoints with Attestations"
    }
  }
}
```

This is the same error, word for word, that PR #439 recorded three days ago. It
is gate 1. Gate 2, the training-data permission, has not been reached, so we
still do not know whether this account would pass it. That question stays open
until somebody ticks the age box.

One correction to PR #439 while we are here. It said a separate account had
already cleared gate 1 and failed on gate 2 instead. Whichever account that was,
it is not the one behind `OPENROUTER_TESTING_KEY` today, because that key fails
on gate 1.

## The production key in the shared `.env` no longer works

This is unrelated to Muse and worth its own line. The `OPENROUTER_API_KEY` in
`~/dev/env/cn-return-bot/env`, which every worktree symlinks as its `.env`, is
rejected by OpenRouter at the account level:

```
GET https://openrouter.ai/api/v1/key
401 {"error":{"message":"User not found.","code":401}}
```

A 401 on that endpoint means the key does not resolve to an account at all, so
it has been revoked or replaced. Every Muse call on that key returned the same
401, which is why the production half of the table above is empty. Note that
this is a *different* failure from the 403: a dead key never gets far enough to
be told about the age gate.

**Production itself is fine.** GitHub Actions holds its own copy of the key as a
repository secret, and that copy still works: `Create Notes Routine` and
`Everything Priority Feeds` were green through 19:48 and 20:03 UTC today, and
production recorded 231 pipeline runs costing $15.00 in the six hours to 19:58
UTC. So the stale copy only breaks local work. Anything run from this devbox
that calls OpenRouter on the production key fails, and the "we re-ran this on
the production account's own key" claim in the GOO-95 writeup cannot be
reproduced here until the file is refreshed.

## Is Spark 1.3 still the latest Muse?

Yes. Asking OpenRouter's live model list for everything under `meta/muse-`
returns seven entries, and the one we declared is the newest:

| Model | Added to OpenRouter | In/Out $/M | Context |
|---|---|---|---|
| meta/muse-spark-1.3-contributor | 2026-09-02 20:38 UTC | 0.10 / 0.20 | 1,048,576 |
| meta/muse-spark-1.3 | 2026-09-02 19:45 UTC | 1.25 / 4.25 | 1,048,576 |
| meta/muse-spark-1.2-contributor | 2026-08-21 18:21 UTC | 0.10 / 0.20 | 1,048,576 |
| meta/muse-glimmer-30b | 2026-08-09 19:06 UTC | 0.30 / 1.10 | 131,072 |
| meta/muse-glimmer-30b:batch | 2026-08-09 19:06 UTC | 0.35 / 1.50 | 131,072 |
| meta/muse-spark-1.2 | 2026-08-05 19:48 UTC | 1.25 / 4.25 | 1,048,576 |
| meta/muse-spark-1.1 | 2026-07-16 15:29 UTC | 1.25 / 4.25 | 1,048,576 |

Nothing newer than Spark 1.3 exists, and nothing cheaper than the contributor
tier exists. So the arm we declared at weight 0 is still the right target and
there is no newer model to switch it to.

Muse Glimmer 30B is the one Muse model that answers us today, but it is not a
candidate. It is older, it is a small 30B model rather than the frontier Spark
line, its context is eight times shorter, and it costs three times more per
input token than the contributor tier we actually want. It was probed only to
work out how wide the age gate is, and the answer is that the gate covers the
Spark line and not Glimmer.

## What unblocks this

One person with access to the OpenRouter account opens
https://openrouter.ai/settings/preferences and confirms 18+. Then this same
command tells us whether gate 2 is also in the way:

```bash
bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts --only muse
```

If all three shapes pass, PR #439's instruction is to set `musespark13c-serper`
to weight 4 in `src/pipeline/ab-testing/abTestsData.ts`. That is Jim's call, not
an automatic follow-on.
