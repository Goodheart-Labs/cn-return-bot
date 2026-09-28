# OpenRouter server tools

OpenRouter "server tools" are tools that OpenRouter itself runs during a request. You add them to the `tools` array with a type that starts with `openrouter:`, the model decides when to call them, OpenRouter executes the call on its own servers and feeds the result back to the model, and the loop continues inside one API request. No client code runs. (The term "server tool" is OpenRouter's own; Anthropic uses the same word for its hosted tools.)

Sources used for this file:

- The OpenAPI spec shipped with the Python SDK: `sdks/openrouter-python-sdk/.speakeasy/out.openapi.yaml` (config schemas and output item schemas, line numbers below). The TypeScript SDK in `sdks/npm-openrouter-sdk/package/esm/models/*.d.ts` is generated from the same spec.
- The OpenRouter docs pages, fetched as markdown on 2026-09-23 from `https://openrouter.ai/docs/guides/features/server-tools*.md`.
- `sdks/openrouter-agent/packages/agent/src/lib/model-result.ts` and `doom-loop.ts` for how the agent SDK uses the advisor tool.
- **Live probes** (my own, 2026-09-23, through the chat completions endpoint with `OPENROUTER_TESTING_KEY`). The model-facing descriptions of these tools are not in the SDKs or the docs. I obtained them by giving `deepseek/deepseek-chat-v3.1` and `qwen/qwen3-235b-a22b-2507` all six tools and asking each to print its tool definitions verbatim. Both models printed the same text (Qwen dropped one sentence in the search description, so the DeepSeek copy is used). The raw tool results were obtained the same way: the model called the tool and then echoed the result. These are **model-echoed**, not read from source, so treat them as very likely but not guaranteed verbatim. The probe applies to the case where OpenRouter exposes its own function tool, which is what happens for models without native search (or when `engine` is set to a non-native engine). For Anthropic, OpenAI, Google, xAI and Perplexity models on `engine: "auto"`, the provider's own hosted search runs instead and the model sees the provider's tool (see the other files in this folder).

## Index

| Tool (type) | Name the model sees | Where it runs | Model fills in | Returns to the model |
|---|---|---|---|---|
| `openrouter:web_search` | `openrouter_web_search` | OpenRouter server, calling Exa / Parallel / Perplexity / Firecrawl, or the provider's native search | `query` | JSON `{status, error, results:[{id, url, title, text}]}`; `text` is query-relevant excerpts (Exa highlights) |
| `openrouter:web_fetch` | `openrouter_web_fetch` | OpenRouter server (Exa Contents, Parallel extract, Firecrawl, raw HTTP, or native fetch) | `url` | JSON `{url, content, title, status, http_status, retrieved_at}` |
| `openrouter:datetime` | `openrouter_datetime` | OpenRouter server | nothing | JSON `{datetime, timezone}` |
| `openrouter:advisor` | `openrouter_advisor` (one per named advisor) | Nested model call to any OpenRouter model | `prompt`, optional `model` | JSON `{status, model, advice}` |
| `openrouter:subagent` | `openrouter_subagent` (one per named worker) | Nested model call, optionally an agent loop with server tools | `task_name`, `task_description` | JSON `{status, model, task_name, outcome}` |
| `openrouter:fusion` | `openrouter_fusion` | Nested panel of up to 8 models, each with web_search + web_fetch, then an analyst model | `prompt` | JSON `{status, analysis:{consensus, contradictions, partial_coverage, unique_insights, blind_spots}, responses:[{model, content}]}` |

## The outer loop and its budget (applies to every server tool)

From `server-tools.md` ("Tool Call Limits"), verbatim:

```text
Every request that uses server tools runs an agent loop with a step budget. Each tool call the model makes (a web search, an image generation, etc.) consumes one step; when the budget is exhausted, the model is asked to produce its final answer with the context gathered so far.
```

| Field | Default | Max | Behavior (verbatim) |
|---|---|---|---|
| `max_tool_calls` | `30` | `30` | Total server-tool steps allowed for the request, across all server tools |
| `stop_server_tools_when` | None | None | Array of stop conditions (step count, spend cap, and more). When set, it **overrides** `max_tool_calls` |

These are top-level request fields (siblings of `messages`), set by the developer. The model is not told the budget up front; nothing in any tool description mentions a limit (see descriptions below). It only learns about a limit when a call is refused (see `max_uses` below). Usage comes back in `usage.server_tool_use.web_search_requests`; in my probe the chat completions response carried `usage.server_tool_use_details = {web_search_requests, tool_calls_requested, tool_calls_executed}`.

---

## 1. `openrouter:web_search`

**Where it runs:** OpenRouter's server. The engine is picked by config: `auto` (default) uses the provider's native search if the model has one, otherwise Exa. The spec (`out.openapi.yaml:28441`) describes the type as "OpenRouter built-in server tool: searches the web for current information".

### Description, verbatim (model-echoed, see Sources)

Tool name `openrouter_web_search`:

```text
Search the web and return ranked excerpts from matching pages.

- Provides up-to-date information for current events, recent releases, and data past your knowledge cutoff
- Returns each result as a title, URL, and excerpt of the page's relevant content
- Searches execute automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - A query is a single string, and each call is scored independently. Results from separate calls are NEVER intersected.
  - Therefore you MUST put every criterion that must hold at the same time into ONE query, together with any named entities, qualifiers, and time or place bounds you already know.
  - NEVER split a multi-criteria question into one query per criterion. Doing so returns pages matching only a single criterion and is the most common cause of a wrong answer.
  - Example - to find a round red fruit that grows on trees:
    CORRECT: one search for "round red fruit that grows on trees"
    WRONG: three searches for "round fruit", "red fruit", and "fruit that grows on trees"
  - Start specific. Only broaden a query after a specific one returns nothing useful, and when you broaden, drop the least essential criterion rather than all of them.

Usage notes:
  - Each result is an excerpt, not the full page. If an excerpt is insufficient, search again with added detail rather than repeating the same query.
  - When searching for recent information, documentation, or current events, use the current year in the query rather than a past year. If you are unsure of the current date and a datetime tool is available, call it first.
```

### Parameters the model fills in (model-echoed)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": { "query": { "type": "string" } },
  "required": ["query"],
  "additionalProperties": false
}
```

Only `query`, with no description on the property. No result count, no date filter, no domain filter is exposed to the model.

### Configuration the developer sets (`parameters` on the tool entry)

From `WebSearchServerToolConfig`, `out.openapi.yaml:28457`, descriptions verbatim:

| Name | Type | Default | Description |
|---|---|---|---|
| `engine` | enum `native, exa, parallel, firecrawl, perplexity, auto` | `auto` | Which search engine to use. "auto" (default) uses native if the provider supports it, otherwise Exa. "native" forces the provider's built-in search. "exa" forces the Exa search API. "firecrawl" uses Firecrawl (requires BYOK). "parallel" uses the Parallel search API. "perplexity" uses the Perplexity Search API (raw ranked results). |
| `max_results` | integer | 5 | Maximum number of search results to return per search call. Defaults to 5. Applies to Exa, Firecrawl, Parallel, and Perplexity engines; ignored with native provider search. Perplexity supports a maximum of 20; values above 20 are clamped. |
| `max_total_results` | integer | 50 | Maximum total number of search results across all search calls in a single request. Once this limit is reached, the tool will stop returning new results. Useful for controlling cost and context size in agentic loops. Defaults to 50 when not specified. |
| `max_uses` | integer | none | Maximum number of web searches the model may perform in a single request. Once reached, further search calls return an error result instead of executing. Applies to the Exa, Firecrawl, Parallel, and Perplexity engines. With native provider search, forwarded only to Anthropic (as `max_uses`); other native search providers have no equivalent parameter and ignore it. |
| `max_characters` | integer | none | Exact maximum number of characters of content per search result. Applies to the Exa, Parallel, and Perplexity engines; ignored with native provider search and Firecrawl. For Exa, caps highlight content per result. For Parallel, caps excerpt content per result (default 1,500 when omitted). For Perplexity, maps to the native `max_tokens_per_page` parameter (converted from characters to tokens) and trims the response to the exact character cap. When both `max_characters` and `search_context_size` are set, `max_characters` takes precedence. When omitted, falls back to `search_context_size` mapping (Exa) or engine defaults (Parallel, Perplexity). |
| `search_context_size` | enum `low, medium, high` | adaptive | How much context to retrieve per result. Applies to Exa, Parallel, and Perplexity engines; ignored with native provider search and Firecrawl. For Exa, pins a fixed per-result character cap (low=5,000, medium=15,000, high=30,000); when omitted, Exa picks an adaptive size per query and document (typically ~2,000–4,000 characters per result). For Parallel, controls the total characters across all results; when omitted, Parallel uses its own default size. For Perplexity, maps directly to the Search API's native search_context_size parameter. Overridden by `max_characters` when both are set. |
| `mode` | enum | engine default | Engine-native search mode. Exa supports instant, fast, auto (default), deep-lite, deep, and deep-reasoning. Parallel supports turbo, fast, basic (default), and advanced. Modes unsupported by the selected engine are ignored. |
| `allowed_domains` | string[] | none | Limit search results to these domains. Supported by Exa, Firecrawl, Parallel, Perplexity, and most native providers (Anthropic, OpenAI, xAI). Cannot be used with excluded_domains. |
| `excluded_domains` | string[] | none | Exclude search results from these domains. Supported by Exa, Firecrawl, Parallel, Perplexity, Anthropic, OpenAI, and xAI. Cannot be used with allowed_domains. |
| `user_location` | object `{type:"approximate", city, region, country, timezone}` | none | Approximate user location for location-biased results. |
| `x_search` (docs only) | object | none | "Opt in to X/Twitter search on SpaceXAI models, with optional filters. Only used with native provider search on SpaceXAI; ignored elsewhere" (docs table). |

The docs table lists `max_results` as "1–25; 1–20 for Perplexity" and `max_characters` as "1–100,000".

### What happens when it is called

The implementation is closed source; the following is from the docs and my probes.

- With Exa (the default for any model without native search), OpenRouter asks Exa for **highlights**, not page text. Docs, verbatim: "Highlights are extractive excerpts drawn directly from the page that Exa selects as most relevant to the search query, typically yielding higher-quality context per token than truncated page text for agentic web tooling." Excerpts from different parts of one page are joined with Exa's `[...]` marker (in my probe the separator appeared as `\n\n...\n\n`). Default is 5 results per call, adaptive excerpt size about 2,000 to 4,000 characters each.
- Exa `mode` controls depth and cost: `instant` ~250 ms, `auto` ~1 s ($0.007/request), `deep` 4 to 15 s ($0.012), `deep-reasoning` 12 to 40 s ($0.015).
- The excerpts also come back to the API caller as `url_citation` annotations on the assistant message, with the excerpt in `content` and `start_index = end_index = 0` (my probe). So the citation list is simply every result the search returned, not places where the model cited something.

**Result the model sees** (probe, `engine: "exa"`, `max_results: 2`, `max_characters: 600`, query "Serper API pricing"):

```json
{"status":"ok","error":null,"results":[{"id":"https://serper.dev/","url":"https://serper.dev/","title":"Serper - The World's Fastest and Cheapest Google Search API","text":"Experience unparalleled speed with our industry-leading SERP API, delivering lightning-fast Google search results in 1-2 seconds, at an unbeatable price."},{"id":"https://github.com/api-evangelist/serper","url":"https://github.com/api-evangelist/serper","title":"api-evangelist/serper","text":"Credit-based model. Credits are purchased in advance and valid for 6 months.\n\n...\n\n| Plan | Credits | Price | Per 1K |\n|------|---------|-------|--------|\n| Free Trial | 2,500 | $0 | — |\n| Starter | 50,000 | $50 | $1.00 |\n| Standard | 500,000 | $375 | $0.75 |\n| Scale | 2,500,000 | $1,250 | $0.50 |\n| Ultimate | 12,500,000 | $3,750 | $0.30 |\n\n...\n\nRequesting 100 results per page (non-default) doubles credit consumption."}]}
```

**Result when `max_uses` is exhausted** (probe, `max_uses: 1`, second call):

```json
{"results":[],"status":"max_uses_reached","message":"Search limit reached: 1 searches performed (max_uses: 1)."}
```

Docs say the same happens for `max_total_results`: "subsequent search calls return a message telling the model the limit was hit instead of performing another search."

The API caller sees an output item of type `openrouter:web_search` (`OutputWebSearchServerToolItem`, `out.openapi.yaml:21130`) with `action: {type: "search", query, sources:[{type:"url", url}]}`, deliberately "matching OpenAI web_search_call.action shape".

### Prompt rules elsewhere

None beyond the description itself. The description refers to the datetime tool ("If you are unsure of the current date and a datetime tool is available, call it first").

---

## 2. `openrouter:web_fetch`

**Where it runs:** OpenRouter's server. Spec description (`out.openapi.yaml:28166`): "OpenRouter built-in server tool: fetches full content from a URL (web page or PDF)".

### Description, verbatim (model-echoed)

Tool name `openrouter_web_fetch`:

```text
Fetch the full content of a web page or PDF document at a given URL. Returns the text content, title, and URL.
```

### Parameters the model fills in (model-echoed)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": { "url": { "type": "string" } },
  "required": ["url"],
  "additionalProperties": false
}
```

No offset, no page number, no "find" argument, no prompt. One URL per call.

### Configuration the developer sets

From `WebFetchServerToolConfig`, `out.openapi.yaml:28182`, verbatim:

| Name | Type | Default | Description |
|---|---|---|---|
| `engine` | enum `auto, native, openrouter, exa, parallel, firecrawl` | `auto` | Which fetch engine to use. "auto" (default) uses native if the provider supports it, otherwise Exa. "native" forces the provider's built-in fetch. "exa" uses Exa Contents API. "openrouter" uses direct HTTP fetch. "firecrawl" uses Firecrawl scrape (requires BYOK). "parallel" uses the Parallel extract API. |
| `max_uses` | integer | none | Maximum number of web fetches per request. Once exceeded, the tool returns an error. |
| `max_content_tokens` | integer | none | Maximum content length in approximate tokens. Content exceeding this limit is truncated. |
| `allowed_domains` | string[] | none | Only fetch from these domains. |
| `blocked_domains` | string[] | none | Never fetch from these domains. |

Hard limits from the docs: the OpenRouter and native engines allow at most 50 fetches per request; Exa, Parallel and Firecrawl have none. Pricing: Exa and Parallel $1 per 1,000 fetches, the `openrouter` engine is free.

### What happens when it is called

Documented result shape (docs "Response Format"):

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "content": "The full text content of the page...",
  "status": "completed",
  "retrieved_at": "2025-07-15T14:30:00.000Z"
}
```

and on failure `{"url": ..., "status": "failed", "error": "HTTP 404: Page not found"}`.

What I actually saw in probes:

- **`engine: "openrouter"` returned raw HTML, not extracted text.** Fetching `https://example.com` gave `{"url":"https://example.com","content":"<!doctype html><html lang=\"en\"><head><title>Example Domain</title>...","title":"Example Domain","status":"completed","http_status":200,"retrieved_at":"2026-09-23T20:05:02.058Z"}`. Fetching the Wikipedia "Community Notes" article with `max_content_tokens: 300` returned the start of the HTML `<head>` (class lists and a `<script>` block), so the whole token budget was spent before any article text. The docs describe this engine as "direct HTTP fetch with content extraction", but the extraction did not happen in either probe.
- **`engine: "exa"` returned clean markdown-like text**: the Wikipedia infobox as a markdown table followed by the article prose ("Community Notes (formerly known as Birdwatch) is a feature on X where contributors can add context ...").
- Truncation by `max_content_tokens` is a plain cut. I saw no truncation marker and no hint telling the model how much was left or how to get the rest.

The API caller sees an `openrouter:web_fetch` output item (`OutputWebFetchServerToolItem`, `out.openapi.yaml:21086`) with `url`, `title`, `content`, `httpStatus`, `error`.

---

## 3. `openrouter:datetime`

**Where it runs:** OpenRouter's server. Spec: "OpenRouter built-in server tool: returns the current date and time" (`out.openapi.yaml:8214`).

### Description, verbatim (model-echoed)

```text
Returns the current date and time. Optionally accepts a timezone in the configuration.
```

### Parameters

The model fills in nothing: `{"type":"object","properties":{},"additionalProperties":false}`.
Developer config (`DatetimeServerToolConfig`, `out.openapi.yaml:8230`): `timezone`, string, "IANA timezone name (e.g. "America/New_York"). Defaults to UTC."

### What it returns

Probe result: `{"datetime":"2026-09-23T20:05:03.900Z","timezone":"UTC"}`. Free apart from tokens. The web search description points the model to this tool when it is unsure of the date.

---

## 4. `openrouter:advisor`

**Where it runs:** a nested model call. OpenRouter calls another model (any OpenRouter model) with the executor's prompt and returns the answer as the tool result. The advisor tool is stripped from the advisor's own call, so it cannot recurse (`x-openrouter-advisor-depth` header).

### Description, verbatim (model-echoed)

Tool name `openrouter_advisor` (with several named advisors, the model sees one tool per name; the docs say instance names look like `openrouter_advisor__1`):

```text
Consult a higher-intelligence advisor model for strategic guidance, then continue your work informed by its advice. Use it before committing to an approach on a complex task, when you are stuck, or before declaring a task done.

Pass a `prompt` describing what you need advice on. The advisor reads your prompt (and, when the tool is configured to forward the transcript, the full conversation), thinks, and returns its guidance as this tool's result — you then write the answer yourself.

The advisor adds latency, so skip it for trivial steps a single model can resolve directly.
```

### Parameters the model fills in (model-echoed)

```json
{"type":"object","properties":{"prompt":{"type":"string"},"model":{"type":"string"}},"additionalProperties":false}
```

The docs say `prompt` is "What the model wants advice on. Required unless `forward_transcript` is `true`." and `model` is "Only honored when the tool definition does not fix a `model`." So the executor can pick its own advisor model per call.

### Configuration the developer sets

`AdvisorServerToolConfig`, `out.openapi.yaml:305`, verbatim:

| Name | Description |
|---|---|
| `model` | Slug of the advisor model to consult (any OpenRouter model). When omitted, the executor can choose it via the tool call's `model` argument; if neither is set, the model from the outer API request is used. |
| `name` | Optional name for this advisor. The model sees one tool per named advisor (and one default for an unnamed entry). Names must be unique across advisor entries. Letters, digits, spaces, underscores, and dashes; trimmed; 1–64 chars. |
| `instructions` | System instructions for the advisor sub-agent. When omitted, the advisor responds with no system prompt of its own. |
| `forward_transcript` | When true, the full parent conversation is forwarded to the advisor so it sees the same context the executor does (and the tool-call `prompt`, if given, is appended as a final user turn). When false or omitted, the advisor receives only the `prompt` the executor passes in the tool call. |
| `max_completion_tokens` | Maximum number of output tokens (including reasoning) the advisor may produce. When omitted, the provider's default applies. |
| `reasoning` | `{effort: max…none, max_tokens}` forwarded to the advisor call. |
| `temperature` | Sampling temperature forwarded to the advisor call. |
| `stream` | When true, the advisor's advice streams incrementally as it is produced (Responses API only). |

### What it returns

Docs: `{"status": "ok", "model": "anthropic/claude-opus-4.8", "advice": "Use a channel-based coordination pattern. ..."}`, or `{"status": "error", "error": "Advisor call failed: ..."}` after which "the calling model continues without the advice". Each advisor has **cross-request memory**: when the client replays earlier advisor calls and results, the advisor sees its own earlier prompt/advice pairs. Consultations are "capped per request" (the cap is not stated).

### How the agent SDK uses it

`openrouter-agent` uses the advisor as the "escalate" rung of its doom-loop detector (a detector for agents that repeat the same tool calls). `model-result.ts:2151-2182` appends the tool, forces `toolChoice` to it, and sets these instructions (verbatim, `${verdict.message}` is the detector's description of the loop):

```text
You are an escalation advisor. The executing model appears stuck in a loop: ${verdict.message} Diagnose why its approach is failing and give concrete, specific instructions for a DIFFERENT approach. Do not restate the problem.
```

with `forwardTranscript: true`, capped by `escalation.maxEscalations` (default 2, `doom-loop.ts:148-165`).

---

## 5. `openrouter:subagent`

**Where it runs:** a nested model call to a "worker" model, which may itself run an agent loop over OpenRouter server tools (for example `openrouter:web_search`). Only the worker's final text comes back.

### Description, verbatim (model-echoed)

Tool name `openrouter_subagent`:

```text
Delegate a self-contained task to a smaller, cheaper, faster worker model and receive its outcome. Use it to break a large piece of work into focused sub-tasks that do not need your full capability — summarizing a document, extracting structured data, drafting boilerplate, reformatting text — so you stay free for the parts that do.

Pass a short `task_name` identifying the task and a `task_description` with everything the worker needs: the subagent sees ONLY what you put in the description (it has no access to this conversation), so include all relevant context and the exact output you expect. The worker's result comes back as this tool's `outcome` — review it and integrate it into your work. The worker may have its own tools (e.g. web search) when configured.

Each call is independent: the subagent keeps no memory between tasks. Skip it for work that is faster to do directly than to describe.
```

### Parameters the model fills in (model-echoed)

```json
{"type":"object","properties":{"task_name":{"type":"string"},"task_description":{"type":"string"}},"required":["task_name","task_description"],"additionalProperties":false}
```

### Configuration the developer sets

`SubagentServerToolConfig`, `out.openapi.yaml:25694`, verbatim excerpts:

| Name | Description |
|---|---|
| `model` | Slug of the model that executes delegated tasks (any OpenRouter model). Typically a smaller, cheaper, faster model than the one delegating. When omitted, the model from the outer API request is used. The subagent tool itself cannot be the subagent model. |
| `tools` | Tools the subagent may use while executing a delegated task. The subagent runs as an agentic sub-agent over these tools, then returns its outcome. Only OpenRouter server tools are supported — function tools are rejected — and the list must not include the subagent tool itself. |
| `max_tool_calls` | Maximum number of tool-calling steps the subagent may take during its agentic loop. Capped at 25. Only relevant when the subagent is given tools. Forwarded to the subagent call as `max_tool_calls`. |
| `instructions` | System instructions for the subagent. When omitted, the subagent responds with no system prompt of its own. |
| `name`, `max_completion_tokens`, `reasoning`, `temperature` | As for advisor. |
| `inherit_functions`, `inherited_function_names` | EXPERIMENTAL. Let the worker call the client's own function tools; the run then pauses and the client must replay the worker's opaque `subagent_items`. Responses API only. |

### What it returns

Docs: `{"status": "ok", "model": "anthropic/claude-haiku-4.5", "task_name": "summarize-changelog", "outcome": "Release 2.4 highlights: ..."}` or `{"status": "error", "task_name": ..., "error": "Subagent call failed: ..."}`.

Relevance for research: a subagent with `tools: [{type:"openrouter:web_fetch"}]` is a ready-made "read this page and extract X" tool that keeps the raw page out of the main model's context.

---

## 6. `openrouter:fusion`

**Where it runs:** a nested multi-model pipeline. A panel of 1 to 8 models answers the prompt in parallel, each with its own `openrouter:web_search` + `openrouter:web_fetch` loop (4 steps by default, 16 max), then an analyst model (temperature 0) compares the answers into structured JSON. Spec description (`out.openapi.yaml:9579`): "fans out the user prompt to a panel of analysis models, then asks an analyst model to summarize their collective output as structured JSON the outer model can synthesize from."

### Description, verbatim (model-echoed)

Tool name `openrouter_fusion`:

```text
Fusion is a council of independent models for obtaining perspectives beyond your own. It returns several independent responses plus analysis of their consensus, contradictions, partial coverage, unique insights, and blind spots. Use Fusion when independent perspectives would materially improve the quality of the response or conversation. The value of Fusion depends on the responses being as independently derived as possible: unnecessary shared assumptions or framing can anchor the panel, reduce meaningful variation between responses, and make convergence and divergence less informative. When consulting Fusion, identify what you want help with and the questions you most want answered, then minimize your own influence on how the panel answers them. Provide the goal, neutral questions, and necessary context, but omit your own reasoning, preferred answers, tentative conclusions, and unnecessary assumptions. Fusion has no access to your tools, files, codebase, client state, conversation history, or other context unless you provide it in the prompt, and it cannot investigate them on its own. You may invoke Fusion at most once per request.
```

### Parameters the model fills in (model-echoed)

```json
{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false}
```

### Configuration the developer sets

`FusionServerToolConfig`, `out.openapi.yaml:9597`:

| Name | Default | Description (verbatim, shortened only where marked) |
|---|---|---|
| `analysis_models` | Quality preset (`~anthropic/claude-opus-latest`, `~openai/gpt-sol-latest`, `~google/gemini-pro-latest`) | Slugs of models to run in parallel as the analysis panel. Each model receives the user prompt with openrouter:web_search and openrouter:web_fetch enabled, then an analyst model summarizes the collective output into structured analysis JSON. Capped at 8 models to bound cost amplification. |
| `model` | outer model | Slug of the analyst model that produces the structured analysis JSON. |
| `max_tool_calls` | 4 | Maximum number of tool-calling steps each panelist (analysis model) and the analyst model may take during their agentic web-research loop. Models with web_search/web_fetch enabled iterate until they produce a text response or hit this ceiling. Defaults to 4. Capped at 16. |
| `max_completion_tokens` | 16000 | Maximum number of output tokens (including reasoning tokens) each panelist and the analyst model may produce per inner call. |
| `tools` | web_search + web_fetch | Server tools available to panelist and analyst inner calls. ... Pass an empty array to disable tools entirely (panelists answer from parametric knowledge only). |
| `reasoning`, `temperature` | provider default | Forwarded to panel calls; "The analyst always runs at temperature 0 regardless of this value." |

### What it returns

Docs, structure (`FusionAnalysisResult`, `out.openapi.yaml:9122`):

```json
{
  "status": "ok",
  "analysis": {
    "consensus": ["Points all or most panel models agreed on"],
    "contradictions": [{ "topic": "...", "stances": [{ "model": "...", "stance": "..." }] }],
    "partial_coverage": [{ "models": ["..."], "point": "Only some models covered this" }],
    "unique_insights": [{ "model": "...", "insight": "Something only one model raised" }],
    "blind_spots": ["Topics no panel model addressed"]
  },
  "responses": [{ "model": "anthropic/claude-opus-4.5", "content": "..." }]
}
```

If the analyst fails, `analysis` is omitted and only `responses` come back. Hard failures carry a typed `failure_reason` (`all_panels_failed`, `insufficient_credits`, `rate_limited`, `fusion_invocation_capped`, `unexpected_error`). The API caller also gets `sources`: every page any panel model retrieved, deduplicated by URL.

---

## What is distinctive

- **Search result shape.** JSON with only `id` (= URL), `url`, `title`, `text`. The `text` is query-relevant excerpts chosen by Exa ("highlights"), not the page start and not a Google snippet. There is no date, no rank number and no short id for citing. Five results per call by default, about 2,000 to 4,000 characters each.
- **The search description is opinionated about query writing.** It insists on putting every criterion into one query and forbids splitting a multi-criteria question into one query per criterion, which is the opposite of Perplexity's preset prompt ("Decompose complex queries into discrete, parallel search calls", "2-5 words optimal").
- **Page reading is one call, one URL, whole page, hard cut.** There is no offset, no paging, no in-page find, no "extract with a prompt" parameter. `max_content_tokens` truncates silently. The `openrouter` engine returned raw HTML in my probes, so its token cap was spent on `<head>` markup. Only the Exa engine produced clean text.
- **Budget awareness.** The model is never told the budget in advance. It learns only by hitting it: a refused search returns `{"status":"max_uses_reached","message":"Search limit reached: 1 searches performed (max_uses: 1)."}`; when the outer 30-step budget runs out "the model is asked to produce its final answer".
- **Citations** are added by OpenRouter as `url_citation` annotations for every search result (with the excerpt), not for places the model actually cited.
- **Nested-model tools** (advisor, subagent, fusion) are the unusual part. Fusion in particular is a whole research panel (up to 8 models, each with its own search and fetch loop) behind a single tool call, returning consensus, contradictions and blind spots as structured JSON, limited to one call per request.
