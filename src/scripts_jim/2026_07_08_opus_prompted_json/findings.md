# Opus native-search: prompted-JSON instead of forced json_schema

## Context
`searchWithAnthropicNative` ran Opus 4.8 with a server-side `web_search` tool
**and** a strict `json_schema` response_format. That combination garbles Opus
output ~80% of the time (token-salad, leaked tool-call XML, doubled/empty JSON).
Opus-specific — Sonnet 4.6 with the identical tool+schema is clean.
(See `2026_07_02_opus_garbled_search/`.)

## Change
Drop `response_format`, append `SEARCH_PROMPTED_JSON_INSTRUCTION` to the prompt
(same workaround already used by `searchWithOpenaiNative` / `searchWithSonarBundled`),
and parse with the new preamble-aware `extractJsonObject`.

## Empirical result (`smoke.ts`, Opus 4.8, 5 real posts)
| metric | result |
|---|---|
| salad (garbled) | **0/5** — dropping the schema eliminates the corruption |
| naive `stripJsonFences` + `JSON.parse` | **0/5** — fails on every response |
| `extractJsonObject` + `JSON.parse` | **5/5** — all clean, correct fields |

The minimal fix (drop schema, keep `stripJsonFences`) is **not** enough: Opus
reliably narrates a reasoning preamble before the JSON — e.g.
`"I'll investigate this claim about Clint Eastwood…"` — even with the explicit
"Respond with strict JSON only" instruction, and sometimes wraps the object in
```json fences. So the JSON has to be *extracted* — strip fences, and if a
preamble remains, take the first `{` … last `}` slice — not just fence-stripped.
(The OpenAI / Sonar paths don't need this: those models emit bare JSON.)

## End-to-end (`live_test.ts`, real dispatchSearch, Opus 4.8)
Runs the actual production `dispatchSearch` path (not a replica) over 4 posts and
asserts each returns a valid parsed result — non-empty `findings` string + boolean
`correctionNeeded`. **4/4 pass**, exits non-zero on any throw/malformed result.

Scripts:
- `smoke.ts` — diagnostic: raw output, salad + naive-vs-extract parse comparison.
- `live_test.ts` — assertive integration test through the real dispatchSearch path.
