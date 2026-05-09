# 2026-05-09 — Sonar via OpenRouter probe

## Why this folder exists

Cleanup of the §1 follow-ups from the error-handling refactor (PR #129).
The PR's investigation in
[`2026_05_09_json_parse_failures/`](../2026_05_09_json_parse_failures/)
flagged "Perplexity sonar errors on `response_format`" as a follow-up.
This folder probes more carefully and finds: **no fix needed**. Sonar
already works in production. The earlier probe used the *wrong*
`response_format` shape.

## Methodology

[`01_probe_sonar_response_format.ts`](01_probe_sonar_response_format.ts)
hits OpenRouter with `sonar-pro` and `sonar-reasoning-pro` under four
configs, with a realistic-shaped prompt (system prompt + user message,
asks for findings + correction_needed):

| | Config |
|---|---|
| A | `response_format: { type: "json_schema", json_schema: {...} }` *(current production)* |
| B | `response_format: { type: "json_object" }` |
| C | no `response_format` |
| D | no `response_format` + JSON instruction in the prompt |

## Results

| model | A (json_schema) | B (json_object) | C (none) | D (prompt) |
|---|---|---|---|---|
| `sonar-pro` | ✓ json | **400 error** | plain_text | ✓ json |
| `sonar-reasoning-pro` | ✓ json | **400 error** | plain_text | markdown_fenced |

A is the most reliable: clean JSON for both models. B is what the
earlier `2026_05_09_json_parse_failures/02_test_response_format_strictness.ts`
probe used, and is indeed rejected — but it's not what
[`searchWithSonarBundled`](../../pipeline/simple-bot/searchDispatch.ts#L267)
actually sends. The earlier probe was diagnostic of a configuration
**we don't use**.

Production data over the same 14-day window confirms: `sonar-pro`
had **0** `model_output_invalid` failures; `sonar-reasoning-pro`
had **1** in 36 runs (~3%). Acceptable.

## Conclusion

No code change. The original "sonar errors on response_format"
finding was a false alarm caused by probing with the wrong response
shape. `searchWithSonarBundled` already sends the right config.

## What to watch

If sonar's `model_output_invalid` rate climbs above ~10%, re-run
`01_probe_sonar_response_format.ts` to see whether config A is
still reliable. Possible regressions: OpenRouter dropping
`json_schema` support for these models, or Perplexity changing the
schema-acceptance rules.

---

## Bonus probe: gpt-5 / gpt-5-mini "empty content"

[`02_probe_gpt5_max_tokens.ts`](02_probe_gpt5_max_tokens.ts) chases
down a parallel false alarm. The earlier probe in
`2026_05_09_json_parse_failures/` reported `empty` content for both
`gpt-5` and `gpt-5-mini`. That probe used `max_tokens=200`, which
*could* have starved OpenAI's reasoning models (they spend tokens on
internal reasoning before emitting `content`). Production uses
`max_tokens=4000` and shows essentially no failures.

Probe results (default vs minimal reasoning, max_tokens 200 vs 4000):
all six runs emitted content. Both models reliably finish with
`stop` and produce parseable JSON given a clear instruction. The
reasoning-token budget consumption is visible
(`completion_tokens` includes `reasoning_tokens`) but stays well
under the 200-token budget here.

Production data confirms: `gpt-5` had 1 failure in 1 run (sample
size 1), `gpt-5-mini` had 0 in 3 runs. **No code change needed for
gpt-5 search variants either.**

The lesson: a synthetic JSON-output probe with arbitrary `max_tokens`
isn't diagnostic of the production code path — it can produce
"failures" that don't reflect what the production call actually does.
Future probes should mirror the production parameters.
