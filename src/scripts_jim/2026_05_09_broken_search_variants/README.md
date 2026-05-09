# 2026-05-09 — Why are deepseek / qwen3max searxng variants failing?

## What we know going in

Three simple-bot search variants reject 60–70% of notes at source
verification (vs. ~6% for `sonnet46-native`):

| variant | check_failed rate (Apr 30 – May 9) |
|---|---|
| `deepseek-v4pro-searxng` | 70% |
| `deepseek-v32exp-searxng` | 67% |
| `qwen3max-searxng` | 63% |

The dominant rejection reasoning we saw was *"None of the N source(s)
could be fetched"* — i.e. the URLs cited in the bot's note couldn't be
loaded by the verifier's fetcher. Three hypotheses to discriminate:

| H | Hypothesis | Test |
|---|---|---|
| H1 | Model **hallucinates** URLs that don't exist | Re-fetch each cited URL → 404 dominates |
| H2 | Searxng **truncates** URLs at some character limit; model cites the truncated string | Compare cited URL ↔ searxng-result URLs → many "prefix-but-not-exact" matches |
| H3 | Sites are **paywalled / robots-blocked** for our UA | Re-fetch → 403 / timeout dominates, same URLs would work in a browser |

## Scripts (run in order)

1. `01_pull_failed_runs.py` — pull recent rejected/failed runs for the 3
   variants, write `failed_runs.jsonl`.
2. `02_check_url_fetch.py` — re-fetch each cited URL with the same UA the
   bot's fetcher uses ([tools.ts:314](../../pipeline/tool-calling/tools.ts#L314)).
   Buckets: `ok / http_4xx / http_5xx / timeout / dns / ssl / truncated /
   non_text / other`. Distinguishes H1 (mostly 404) from H3 (mostly 403/timeout).
3. `03_inspect_searxng_results.py` — for each cited URL, check whether it
   appears verbatim in the searxng results recorded in `logs`, or only as
   a prefix-mismatch. High `prefix_in_results` ⇒ H2.

## Decision rule

After running these:
- H1 (hallucination) confirmed → set the variant's weight to 0 in
  [abTests.ts](../../pipeline/ab-testing/abTests.ts) and file a follow-up
  to investigate why these models hallucinate URLs.
- H2 (truncation) confirmed → fix searxng truncation in the simple-bot
  loop (likely a `slice(0, N)` somewhere in the search formatter), don't
  disable the variant.
- H3 (site blocks) confirmed → either rotate UA / use a fetcher with
  better content negotiation, or accept that these models prefer
  paywalled sources and adjust the prompt.
