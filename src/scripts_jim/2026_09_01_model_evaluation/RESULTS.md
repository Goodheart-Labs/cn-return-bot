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
price. Two blockers stop the OpenRouter half of the verification from completing,
and both need Jim: the account is nearly out of credit, and Muse needs a one-time
age confirmation on the account.

Because Muse could not be verified against a live request, both Muse arms ship at
weight 0. Everything else ships at its intended weight. Search goes from a total
weight of 25 to 28, and the writer from 100 to 90; enabling the two Muse arms
later restores those to 32 and 100 and is a change to two numbers.

## What we run today [code]

Model choice lives entirely in `src/pipeline/ab-testing/abTestsData.ts`. Each
pipeline stage has a set of weighted "arms"; every run picks one at random, the
pick is stored on the `pipeline_runs` row, and the stats dashboard plots
helpful-rate and cost-per-helpful-note per arm. Adding a model to the experiment
is therefore a weight in a table, not new code.

Before this change: search carried 14 live arms at total weight 25, the writer 5
arms at total weight 100. Recorded pipeline spend was $50.97/day over the 45 days
to 2026-09-03 [DB].

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

Results as of 2026-09-04:

| Check | Result |
|---|---|
| Advertised parameter support, all 6 OpenRouter candidates | **Pass.** All advertise `response_format`, `structured_outputs`, and, where the searxng loop needs them, `tools` and `tool_choice` |
| Grok 4.6 on the native xAI API with xSearch | **Pass.** Returned parseable JSON after 2 search calls |
| Gemini 3.8 Flash on the native Google API with googleSearch | **Pass** |
| Live OpenRouter calls, all 6 candidates | **Blocked.** See below |

The live OpenRouter calls could not run. Two separate blockers:

1. **The OpenRouter key is out of budget.** It carries a $200 monthly limit with
   $0 remaining, and the account as a whole has $158 of credit left against a
   burn of roughly $100/day. Every call returns
   `403 Key limit exceeded (monthly limit)`.
2. **Muse Spark needs a one-time 18+ confirmation** on the OpenRouter account,
   at https://openrouter.ai/settings/preferences. Until that is done every call
   to either Muse tier returns 403, independent of credit. This is why the Muse
   arms must not go live before someone clicks it.

Re-run once both are cleared:

```bash
bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts
# or, for the free half only:
SKIP_LIVE_CHECKS=1 bun run src/scripts_jim/2026_09_01_model_evaluation/verifyModels.ts
```

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
