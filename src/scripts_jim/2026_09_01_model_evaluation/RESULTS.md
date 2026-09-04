# Are there any better models we should test? (GOO-95)

Research done 2026-09-01 to 2026-09-04. The question was whether models released
recently would do any of our pipeline's jobs better, cheaper, or both.

Sources are marked: **[live API]** is OpenRouter's model-list endpoint,
**[AA]** is the Artificial Analysis Intelligence Index, **[web]** is a secondary
web source, **[DB]** is a read-only query against production, and **[verified]**
means this repository's own check confirmed it.

## Summary

Six new arms were added and four retired. The strongest find is Meta's Muse Spark
1.3 on its "contributor" tier, which scores near Opus 5 for a fiftieth of the
price.

Every arm shipping at a live weight has been verified against a real request in
its real call shape. Muse is the exception: OpenRouter refuses to route to it
until the account opts in to providers that train on prompts, which is the
consent mechanism for the very trade that makes the tier cheap. Both Muse arms
therefore ship at weight 0, so search goes from a total weight of 25 to 28 and
the writer from 100 to 90. Enabling the two arms afterwards restores those to 32
and 100 and is a change to two numbers.

## What we run today [code]

Model choice lives entirely in `src/pipeline/ab-testing/abTestsData.ts`. Each
pipeline stage has a set of weighted "arms"; every run picks one at random, the
pick is stored on the `pipeline_runs` row, and the stats dashboard plots
helpful-rate and cost-per-helpful-note per arm. Adding a model to the experiment
is therefore a weight in a table, not new code.

Before this change: search carried 14 live arms at total weight 25, the writer 5
arms at total weight 100. Recorded pipeline spend was $50.97/day over the 45 days
to 2026-09-03 [DB].

Note on naming: while this work was in progress, main replaced the SearXNG search
backend with Serper and restarted the affected arms under `-serper` names, on the
principle that a new backend is a new treatment. The new tool-calling arms here
follow that convention, so they are `glm53-serper`, `glm53flash-serper` and
`musespark13c-serper`.

One judgement call came out of that merge. Main had just restarted GLM 5.2 as
`glm52-serper` at weight 2 to re-measure it on the new backend. It is retired to
weight 0 here instead, because its false-positive rate is a property of the
model's judgement rather than of the search backend, and GLM 5.3 replaces it in
the same slot. Worth a second opinion if you disagree.

## The candidates

Reference points: Sonnet 5 scores 55.3 at $2/$10 per million tokens, Opus 5
scores 63 at $5/$25.

| Model (OpenRouter ID) | AA score | In/Out $/M | Released | Verdict |
|---|---|---|---|---|
| anthropic/claude-fable-5.1 | 65.7 | 10 / 50 | Sep 1 | Added as a writer arm, replacing Fable 5 |
| meta/muse-spark-1.3-contributor | 62 | 0.10 / 0.20 | Sep 2 | Best value found. Added to both search and writer but **held at weight 0** until the account's 18+ confirmation is done |
| meta/muse-spark-1.3 | 62 | 1.25 / 4.25 | Sep 2 | Skipped. Same model as the contributor tier for 12x the price |
| x-ai/grok-4.6 | 60.9 | 2 / 6 | Aug 12 | Added alongside 4.5, not replacing it. See the caveat below |
| z-ai/glm-5.3 | 59.5 | 1.40 / 4.40 | Aug 18 | Added, replacing GLM 5.2 |
| google/gemini-3.8-flash | 59 | 0.75 / 3.75 | Sep 2 | Added to both search and writer |
| qwen/qwen3.8-max | 58.1 | 2 / 6 | Aug 3 | Skipped. Nothing distinguishes it from arms we already run at that price |
| z-ai/glm-5.3-flash | 57 | 0.075 / 0.25 | Aug 26 | Added to search. Second-best value, with no data-rights trade |
| deepseek/deepseek-v4-pro-0813 | 53.2 | 0.66 / 1.98 | Aug 12 | Skipped. Beaten by glm-5.3-flash on score per dollar |

Scores [AA], prices and dates [live API]. Filtered from OpenRouter's 418 models
by dropping free variants (rate-limited), unpinned `latest` aliases (the price
can move under us), image and audio output models, and OpenRouter's own routing
pseudo-models.

Two caveats on the scores. The AA index leans on coding and reasoning
benchmarks rather than fact-checking, so it is a prior and not a verdict.
And Grok 4.6, despite scoring well, is reported to fabricate more confidently
than 4.5, with the hallucination rate rising from 0.98% to 1.70% [web]. That is
why both Grok arms now run side by side instead of 4.6 replacing 4.5.

### Meta's contributor tier

The contributor tier is the same model as the standard tier: same weights, same
1M-token context, same benchmark scores, and the same advertised parameter list
including tool calling [verified, live API]. It costs $0.10/$0.20 instead of
$1.25/$4.25, and cached input drops from $0.15 to $0.002 per million. In exchange
Meta may train on the prompts and completions we send; on the standard tier they
contractually may not [web].

Everything we send is a public tweet, its public comments and media, public
search results, or a note draft written to be published, so the trade costs us
little. Two consequences are worth remembering. The tier is capped at 60 requests
per minute rather than 3,000, which is comfortable at weight 4 but would not
carry a main arm, so promoting it later means moving to the standard tier. And
Meta's terms bar sending sensitive, confidential or personal information, which
is a reason to revisit this if the pipeline ever handles non-public input.

## What production already said [DB]

45 days to 2026-09-03: 32,862 runs, 2,593 submitted notes, of which only 392 are
rated (305 helpful, 87 not). Every exploratory arm therefore rests on single-digit
helpful counts, so all of this is directional.

- The two Opus 5 search arms lead on quality, at 18.6% and 16.7%
  helpful-per-submitted and 89% and 92% helpful among rated notes, at a
  competitive $5.50 to $5.70 per helpful note. Opus 5 medium was raised from
  weight 1 to 2 on the strength of that.
- Grok 4.5 ($4.43 per helpful, 14.2%) and Kimi K3 ($5.32, 15.0%) also beat the
  Sonnet 5 baseline (11.3%, $8.57) on both axes.
- GLM 5.2 had the worst false-positive profile of any arm: 13 of its 28 rated
  notes came back not-helpful, against 8% to 29% not-helpful everywhere else.
  Retired.
- Gemini 3.1 Pro and GPT-5.6 Sol were weak on helpful rate and the most expensive
  per helpful note, at $12.52 and $13.93. Retired.
- Gemini 3.6 Flash submitted notes at about half the rate of the other arms and
  is superseded by 3.8 Flash at the same price. Retired.
- The three big writer arms are nearly indistinguishable, 11.5% to 12.6%
  helpful-per-submitted at about $7.20 to $7.70 per helpful note. The Opus 5
  writer arm trails at 6.3% and $15.57, but its notes are mostly unrated, so it
  was wound down from 10 to 5 rather than retired.

## Verification

`verifyModels.ts` in this folder checks each candidate against the exact
parameter shapes the pipeline sends. It imports the real client and the real
response formats rather than copies, so a pass means the production call shape
works.

The check matters because every OpenRouter call sets
`provider: { require_parameters: true }`, which routes only to providers that
honour every parameter in the request. A model that does not support one of them
does not degrade quietly; the request fails outright. That is how Perplexity
Sonar was found to be unusable with `json_schema`.

The script sends its OpenRouter calls with `OPENROUTER_TESTING_KEY` when that is
set, so verification never eats into the production key's budget. The whole run
costs about a cent.

Results as of 2026-09-04, 14 of 17 checks passing:

| Model | Check | Result |
|---|---|---|
| All 6 OpenRouter candidates | Advertised parameter support | **Pass** |
| anthropic/claude-fable-5.1 | Live writer call, strict json_schema | **Pass**, parsed cleanly, $0.0075 |
| google/gemini-3.8-flash | Live writer call, strict json_schema | **Pass**, parsed cleanly, $0.0015 |
| z-ai/glm-5.3 | Live search call, tools forced | **Pass**, called `google_search` |
| z-ai/glm-5.3 | Live search call, tools plus schema | **Pass**, returned schema JSON |
| z-ai/glm-5.3-flash | Live search call, tools forced | **Pass**, called `google_search` |
| z-ai/glm-5.3-flash | Live search call, tools plus schema | **Pass**, chose a tool call |
| x-ai/grok-4.6 | Live native xAI call with xSearch | **Pass**, parseable JSON after 2 searches |
| google/gemini-3.8-flash | Live native Google call with googleSearch | **Pass** |
| meta/muse-spark-1.3-contributor | All three live shapes | **Blocked**, see below |

So every arm that ships at a live weight in this change has been exercised
against a real request in its real call shape.

### Why Muse is still blocked

Muse is the one model that could not be called. The account has to accept the
data-training trade before OpenRouter will route to the endpoint at all:

```
404 0 endpoints out of 1 requested are available matching your guardrail
restrictions and data policy.
Paid model training violation (account settings): 1 endpoint excluded
reason: paid-model-training-violation-by-account
configure at https://openrouter.ai/settings/privacy
```

That setting is the consent mechanism for exactly the trade described above, so
it is a deliberate decision rather than a formality. A second setting is also
needed: on the production key the same calls returned
`403 ... requires 18+ age confirmation`, set at
https://openrouter.ai/settings/preferences. The testing key got past that one but
not the privacy one, so if the two keys belong to different accounts, the account
production uses needs both.

Both Muse arms therefore ship at weight 0. Re-run the script after changing those
settings; when Muse passes, set the search arm to 4 and the writer arm to 10.

```bash
bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts
# or, for the free half only, which needs no credit:
SKIP_LIVE_CHECKS=1 bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts
```

### A separate problem this turned up

The production OpenRouter key is out of budget: a $200 monthly limit with $0
remaining, so every call on it returns `403 Key limit exceeded (monthly limit)`.
More importantly the account as a whole had $158.39 of credit left against a burn
of roughly $100/day, which is about a day and a half of runway. Production was
still submitting notes at 13:24 UTC on 2026-09-04, so whatever key CI uses is not
the capped one, but the account ceiling applies to everything.

The `OPENROUTER_MGMT_KEY` in the env file returns 401, so the account's keys
could not be listed to confirm which one CI uses.

## The cost-tracking bug this uncovered

Grok and Gemini searches run on the vendors' own APIs, which report no cost the
way OpenRouter does, so we compute it from rate tables in
`src/pipeline/cost-tracking/pricing.ts`. A model with no row there records every
run at cost 0 and nothing fails.

`grok-4.5` had been live at weight 2 with no row, so a month of its runs recorded
as free, which made it look like the cheapest arm per helpful note in exactly the
comparison this research depends on. Running the verification script surfaced a
second instance: `gemini-3.8-flash` had no row either, so the new arm would have
had the same problem on day one.

Both are fixed, and `pricingCoverage.test.ts` now fails the build when a live
native-API arm has no rate, so this cannot recur silently.

## Open questions

- Whether Muse contributor holds up in production, and whether it hits the 60
  requests per minute ceiling.
- Whether Fable 5.1 earns its price as a writer. This is the direct answer to
  the question the ticket asked.
- Whether Grok 4.6's higher reported fabrication rate shows up in our own
  not-helpful counts.
- The review checkpoint is GOO-103, about three weeks after this merges.
