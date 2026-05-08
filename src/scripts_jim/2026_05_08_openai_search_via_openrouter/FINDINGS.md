# OpenAI web_search_preview via OpenRouter — Phase 0 spike

**Question:** Does OpenRouter pass through OpenAI's Responses-API `web_search_preview` tool, so that `simple-bot` can use it via the existing `llm.create` (OpenRouter) client?

**Answer:** Yes. No native `openai.ts` client is needed.

## Evidence

`bun run src/scripts_jim/2026_05_08_openai_search_via_openrouter/spike.ts` against `openai/gpt-5.4-mini`:

- `tools: [{ type: "web_search_preview" }]` — works. Response includes grounded `message.annotations` with `url_citation` entries. `usage.server_tool_use.web_search_requests` is populated.
- `tools: [{ type: "web_search" }]` — also works (OpenRouter accepts both names). Returns the same annotations shape, used 2 search calls in the test query.
- `tools: [{ type: "web_search_20260209" }]` (Anthropic-style) — rejected with `400 invalid_request_error`. Expected.
- `tools: [{ type: "web_search_preview_2025_03_11" }]` — also valid per the error message above.

## Implication for commit 7

`searchWithOpenaiNative` collapses into a thin `llm.create` call with `tools: [{ type: "web_search_preview" }]` and our shared JSON response_format. Citations flow through existing `extractCitations(result)` (it reads `message.annotations`).

No `OPENAI_API_KEY` env var. No new SDK. The plan's commit-7 file `src/pipeline/llm/openai.ts` is **not** needed.
