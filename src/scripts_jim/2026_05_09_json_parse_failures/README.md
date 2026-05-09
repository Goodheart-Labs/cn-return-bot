# 2026-05-09 — JSON-parse failures: which provider misbehaves?

## Background

`parseSearchJson` in [searchDispatch.ts:88](../../pipeline/simple-bot/searchDispatch.ts#L88)
throws `ModelOutputInvalidError` when the search step's LLM response
isn't valid JSON. Pre-refactor those errors landed in `bot_error`;
post-refactor they have their own `outcome_reason='model_output_invalid'`.

The user's framing was: *we should be able to force JSON output from
every API*. We pass `response_format: { type: "json_object" }` to
OpenRouter today, but production still shows three failure shapes:
empty content, markdown-fenced JSON, and English preamble before the JSON.
Each implies a different fix.

## Scripts (run in order)

1. `01_pull_invalid_outputs.py` — pulls all `model_output_invalid` rows
   (and historical `bot_error` rows whose message contains "not valid JSON")
   from the last 14 days. Buckets by `(provider, content_shape)` and writes
   one sample row per bucket.

   The shape buckets:
   - `empty` — content was `""` (likely a tool-use response that we read
     the wrong field of, OR a 0-token completion).
   - `markdown_fenced` — model wrapped JSON in ```` ```json ```` fences.
   - `preamble` — model emitted prose ("Based on my research…") then JSON.
   - `truncated_json` — starts with `{` but doesn't close (max_tokens hit?).
   - `plain_text` — no JSON-like structure at all.

2. `02_test_response_format_strictness.ts` — for each search-providing
   model, sends a trivial JSON-output prompt to OpenRouter twice — once
   `with response_format: { type: "json_object" }`, once without. Records
   the resulting shape per model. Tells us:
   - Which models honor `response_format` (probe → `json` shape with format).
   - Which models silently ignore it (probe → `markdown_fenced` or
     `preamble` even with format).
   - Whether OpenRouter passes the flag through at all (compare with vs
     without).

   Run from repo root:
   ```
   bun run src/scripts_jim/2026_05_09_json_parse_failures/02_test_response_format_strictness.ts
   ```

## Interpretation → fix

| Probe result | Production fix |
|---|---|
| Provider X honors `response_format` in probe but production still fails for X | Bug in our call site — verify the flag is actually being passed. |
| Provider X ignores `response_format` even in probe | Use the provider's native SDK (Anthropic / Gemini / Grok) with strict JSON-schema mode, OR drop the variant. |
| Provider X is `empty` in production but works in probe | Likely a tool-use response we're reading wrong. Inspect the raw response shape in [searchDispatch.ts](../../pipeline/simple-bot/searchDispatch.ts). |
| Provider X is `truncated_json` | Bump `max_tokens` for that model. |

## Why no regex fallback in the parser

We deliberately did NOT add a balanced-brace fallback to `parseSearchJson`.
A regex would hide the heterogeneous failure modes — we'd lose the signal
that distinguishes "provider ignores `response_format`" from "tool-use
response shape mismatch" from "max_tokens cutoff." The right fix is
provider-specific, and `01` + `02` here tell us which is which.
