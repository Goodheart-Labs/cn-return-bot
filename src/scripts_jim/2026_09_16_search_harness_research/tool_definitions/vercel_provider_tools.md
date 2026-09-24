# Vercel AI SDK: provider tools and AI Gateway search tools

Sources read (all under `sdks/ai/packages/`):
- `anthropic/src/tool/*.ts`, `anthropic/src/anthropic-prepare-tools.ts`, `anthropic/src/anthropic-api.ts`, `anthropic/src/anthropic-language-model.ts`
- `openai/src/tool/web-search.ts`, `openai/src/responses/openai-responses-language-model.ts`
- `google/src/tool/*.ts`, `google/src/google-prepare-tools.ts`, `google/src/google-language-model.ts`
- `xai/src/tool/*.ts`, `xai/src/responses/xai-responses-prepare-tools.ts`
- `gateway/src/tool/{exa,parallel,perplexity,tako}-search.ts`
- Docs: `sdks/ai/content/providers/01-ai-sdk-providers/00-ai-gateway.mdx`

## How to read this file

The AI SDK has two very different kinds of "provider tool":

1. **Wrappers for provider-hosted tools** (Anthropic, OpenAI, Google, xAI). The SDK file only declares (a) the developer configuration, (b) an input schema describing what the model's call looks like in the response, and (c) an output schema for parsing the result. The SDK sends `{type: "web_search_20250305", name: "web_search", max_uses: ...}` and the provider's server supplies the real description and runs the tool. **The model-facing description is never in the SDK.** For these, the useful information here is the exact input and output shapes, which show what the model fills in and what it reads back.
2. **AI Gateway tools** (`gateway.tools.exaSearch()` etc.). These run on Vercel's AI Gateway servers and work with any model. Their input schemas carry `.describe()` strings that are the per-parameter text the model sees. The top-level tool description is set on the gateway server and is not in this repo.

All provider tools are created with `createProviderExecutedToolFactory`, meaning the SDK's own loop never executes them; the result arrives already inside the model response.

## Index

| SDK name | Provider API tool | Runs where | Model fills in | Result shape the SDK parses |
|---|---|---|---|---|
| `anthropic.tools.webSearch_20250305` / `_20260209` / `_20260318` | `web_search` | Anthropic servers | `query` | list of `{url, title, pageAge, encryptedContent}` |
| `anthropic.tools.webFetch_20250910` / `_20260209` / `_20260318` | `web_fetch` | Anthropic servers | `url` | `{url, content: document(text or PDF), retrievedAt}` |
| `anthropic.tools.advisor_20260301` | `advisor` | Anthropic, nested model call | nothing (empty input) | `{text}` advice, or encrypted, or error |
| `anthropic.tools.codeExecution_*`, `toolSearchBm25/Regex`, `memory`, `bash`, `textEditor`, `computer` | various | mixed | — | brief only |
| `openai.tools.webSearch` / `webSearchPreview` | `web_search` | OpenAI servers | hidden (empty input schema) | `{action: search/openPage/findInPage, sources}` |
| `google.tools.googleSearch` | `googleSearch` | Google servers | hidden | grounding metadata (chunks + supports) |
| `google.tools.urlContext` | `urlContext` | Google servers | hidden (URLs come from the prompt) | `urlContextMetadata` |
| `google.tools.enterpriseWebSearch` | `enterpriseWebSearch` | Google (Vertex) | hidden | grounding metadata |
| `xai.tools.webSearch` | `web_search` | xAI servers | hidden | `{action, sources}` |
| `xai.tools.xSearch` | `x_search` | xAI servers | hidden | `{query, posts: [{author, text, url, likes}]}` |
| `xai.tools.viewImage` / `viewXVideo` | `view_image` / `view_x_video` | xAI servers | none | description / transcript |
| `gateway.tools.exaSearch` | `exa_search` | Vercel AI Gateway | `query` + many options | Exa results with optional text / highlights |
| `gateway.tools.parallelSearch` | `parallel_search` | Vercel AI Gateway | `objective` (+ queries) | `{url, title, excerpt, publishDate, relevanceScore}` |
| `gateway.tools.perplexitySearch` | `perplexity_search` | Vercel AI Gateway | `query` (string or up to 5) | `{title, url, snippet, date, lastUpdated}` |
| `gateway.tools.takoSearch` | `tako_search` | Vercel AI Gateway | data query | data "cards" (brief) |

---

## Anthropic

### A1. `web_search` (`webSearch_20250305`, `webSearch_20260209`, `webSearch_20260318`)

**Where it runs:** Anthropic's servers. The model-facing description is not in the SDK (see `anthropic_server_tools.md` for Anthropic's docs).

**Model input** (`anthropic/src/tool/web-search_20260209.ts`, identical in all three versions):

```ts
z.object({ query: z.string() })
// JSDoc: "The search query to execute."
```

**Developer configuration** (JSDoc verbatim):

| Field | Type | Description |
|---|---|---|
| `maxUses` | number? | "Maximum number of web searches Claude can perform during the conversation." |
| `allowedDomains` | string[]? | "Optional list of domains that Claude is allowed to search." |
| `blockedDomains` | string[]? | "Optional list of domains that Claude should avoid when searching." |
| `userLocation` | `{type: 'approximate', city?, region?, country?, timezone?}` | "Optional user location information to provide geographically relevant search results." |
| `responseInclusion` (20260318 only) | `'full' \| 'excluded'` | "Controls whether web search result blocks consumed by completed code execution calls are included in the response. Defaults to `full`." |

Sent as (`anthropic-prepare-tools.ts:321-370`): `{type: 'web_search_20250305' | 'web_search_20260209' | 'web_search_20260318', name: 'web_search', max_uses, allowed_domains, blocked_domains, user_location[, response_inclusion]}`. Version `20260209` also adds the beta header `code-execution-web-tools-2026-02-09`; this is the "dynamic filtering" version where Claude can run code over search results before they enter its context (details in `anthropic_server_tools.md`).

**Result** (JSDoc verbatim):

```ts
Array<{
  type: 'web_search_result';
  url: string;              // "The URL of the source page."
  title: string | null;     // "The title of the source page."
  pageAge: string | null;   // "When the site was last updated"
  encryptedContent: string; // "Encrypted content that must be passed back in multi-turn conversations for citations"
}>
```

So the page text that Claude reads is **encrypted and opaque** to the developer. The developer only sees URL, title and page age.

**Citations.** Text blocks come back with citations of type `web_search_result_location` (`anthropic-api.ts:676`): `{cited_text, url, title, encrypted_index}`. The SDK turns each one into a URL source and keeps `citedText` in provider metadata (`anthropic-language-model.ts:130-144`). Unlike OpenAI's `url_citation`, this carries the **quoted text** that supports the claim. Document citations (`char_location`, `page_location`, `content_block_location`, `search_result_location`) carry `cited_text` plus character or page indices.

### A2. `web_fetch` (`webFetch_20250910`, `webFetch_20260209`, `webFetch_20260318`)

**Where it runs:** Anthropic's servers.

**Model input:** `{ url: string }` ("The URL to fetch.").

**Developer configuration** (JSDoc verbatim, `web-fetch-20260318.ts`):

| Field | Type | Description |
|---|---|---|
| `maxUses` | number? | "The maxUses parameter limits the number of web fetches performed" |
| `allowedDomains` | string[]? | "Only fetch from these domains" |
| `blockedDomains` | string[]? | "Never fetch from these domains" |
| `citations` | `{enabled: boolean}`? | "Unlike web search where citations are always enabled, citations are optional for web fetch. Set \"citations\": {\"enabled\": true} to enable Claude to cite specific passages from fetched documents." |
| `maxContentTokens` | number? | "The maxContentTokens parameter limits the amount of content that will be included in the context." |
| `useCache` (20260318 only) | boolean? | "Whether cached content may be returned. Set to `false` to fetch fresh content. Defaults to `true`." |
| `responseInclusion` (20260318 only) | `'full' \| 'excluded'` | "Controls whether web fetch result blocks consumed by completed code execution calls are included in the response. Defaults to `full`." |

**Result:**

```ts
{
  type: 'web_fetch_result';
  url: string;                          // "Fetched content URL"
  content: {
    type: 'document';
    title: string | null;               // "Title of the document"
    citations?: { enabled: boolean };   // "Citation configuration for the document"
    source:
      | { type: 'base64'; mediaType: 'application/pdf'; data: string }
      | { type: 'text';   mediaType: 'text/plain';      data: string };
  };
  retrievedAt: string | null;           // "ISO 8601 timestamp when the content was retrieved"
}
```

Notable: the fetched page is returned as a **document block**, the same object type as a user-uploaded document. That is what lets Claude cite it with `char_location` indices and `cited_text`. PDFs are passed through whole as base64 rather than converted to text. Truncation is by `maxContentTokens`, set by the developer; there is no page/offset parameter for the model.

### A3. `advisor` (`advisor_20260301`)

**Where it runs:** a nested model call on Anthropic's servers. The executor model calls `advisor` with **empty input**; the server builds the advisor model's view from the full transcript (comment in `advisor_20260301.ts`: "Input is always empty: the executor emits server_tool_use with empty input and the server constructs the advisor's view from the full transcript.").

Developer configuration (JSDoc verbatim, abridged to the first sentences):
- `model`: "The advisor model ID, such as `\"claude-opus-4-8\"`. Billed at this model's rates for the sub-inference. The advisor must be at least as capable as the executor; an invalid pair returns a `400 invalid_request_error` from the API."
- `maxUses`: "Maximum number of advisor calls allowed in a single request. Once the executor reaches this cap, further advisor calls return an `advisor_tool_result_error` with `error_code: \"max_uses_exceeded\"` and the executor continues without further advice."
- `maxTokens`: "Maximum number of tokens the advisor can generate per call, including thinking and text. [...] The minimum value is 1024. Anthropic recommends starting with 2048."
- `caching`: `{type: 'ephemeral', ttl: '5m' | '1h'}`, "Enables prompt caching for the advisor's own transcript across calls within a conversation."

Result: `{type: 'advisor_result', text, stopReason?}` ("Plaintext advice from the advisor model."), or `advisor_redacted_result` with `encryptedContent`, or `advisor_tool_result_error` with `errorCode` in `max_uses_exceeded`, `too_many_requests`, `overloaded`, `prompt_too_long`, `execution_time_exceeded`, `unavailable`.

Relevance: this is a "second opinion from a stronger model" tool. A cheap model doing the research can ask an expensive model to review its reasoning so far.

### A4. Brief: other Anthropic tools

`codeExecution_20250522 / _20250825 / _20260120` (sandboxed code; the 2026 versions can call `web_search` / `web_fetch` from inside code, which is how dynamic filtering works), `toolSearchBm25_20251119` / `toolSearchRegex_20251119` (search over deferred tool definitions), `memory_20250818` (client-executed file-like memory), `bash`, `textEditor`, `computer` (client-executed).

---

## OpenAI

### O1. `web_search` (`openai.tools.webSearch`) and `webSearchPreview`

**Where it runs:** OpenAI servers. Model-facing description not public (see `openai_hosted_tools.md`).

**Model input:** empty. The SDK comment says: "Web search doesn't take input parameters - it's controlled by the prompt" (`openai/src/tool/web-search.ts`).

**Developer configuration** (JSDoc verbatim):

| Field | Description |
|---|---|
| `externalWebAccess` | "Whether to use external web access for fetching live content. - true: Fetch live web content (default) - false: Use cached/indexed results" |
| `filters.allowedDomains` | "Allowed domains for the search. If not provided, all domains are allowed. Subdomains of the provided domains are allowed as well. Omit the HTTP or HTTPS prefix. Maximum 100 domains." |
| `filters.blockedDomains` | "Blocked domains for the search. Subdomains of the provided domains are blocked as well. Omit the HTTP or HTTPS prefix. Maximum 100 domains." |
| `searchContextSize` | "Search context size to use for the web search. - high: Most comprehensive context, highest cost, slower response - medium: Balanced context, cost, and latency (default) - low: Least context, lowest cost, fastest response" |
| `userLocation` | "User location information to provide geographically relevant search results." (country "Two-letter ISO country code (e.g., 'US', 'GB')", city, region, timezone "IANA timezone (e.g., 'America/Chicago')") |

**Result** (what the SDK parses from each `web_search_call` item):

```ts
{
  action?:
    | { type: 'search'; query?: string /* @deprecated Use `queries` instead. */; queries?: string[] /* "The search queries the model used." */ }
    | { type: 'openPage'; url?: string | null /* "The URL opened by the model." */ }
    | { type: 'findInPage'; url?: string | null; pattern?: string | null /* "The pattern or text to search for within the page." */ };
  sources?: Array<{ type: 'url'; url: string } | { type: 'api'; name: string }>; // "Optional sources cited by the model for the web search call."
}
```

Two details beyond the Python SDK: `sources` can contain `{type: 'api', name}` entries (results from an OpenAI internal data API rather than a web page), and the SDK **automatically requests** `include: ['web_search_call.action.sources']` whenever a web search tool is present (`openai-responses-language-model.ts:490-504`), unless the developer sets `includeWebSearchSources: false`.

---

## Google

### G1. `google_search` (`google.tools.googleSearch`)

**Where it runs:** Google's servers ("Grounding with Google Search"). Model-facing description not public, and there is no visible tool call at all: the model searches internally and returns grounded text.

**Model input:** empty schema. **Developer config** (`google/src/tool/google-search.ts`): `searchTypes: {webSearch?: {}, imageSearch?: {}}`, `timeRangeFilter: {startTime, endTime}`. Sent as `{googleSearch: {...args}}` (`google-prepare-tools.ts:80-83`). Requires Gemini 2.0 or newer; before Gemini 3, mixing it with function tools gives a warning "combination of function and provider-defined tools".

**Result:** no tool result object. Instead the candidate carries `groundingMetadata` (`google-language-model.ts:1527-1592`):

```ts
{
  webSearchQueries?: string[];
  imageSearchQueries?: string[];
  searchEntryPoint?: { renderedContent: string };   // HTML search chip Google requires you to display
  groundingChunks?: Array<{ web?: {uri, title}; image?: {...}; retrievedContext?: {...}; maps?: {...} }>;
  groundingSupports?: Array<{
    segment?: { startIndex, endIndex, text };       // span of the answer
    groundingChunkIndices?: number[];               // which chunks support that span
    confidenceScores?: number[];
  }>;
  retrievalMetadata?: { webDynamicRetrievalScore: number };
}
```

Citation mechanics: each answer segment points to chunk indices with a confidence score, but there is no quoted source text. The SDK turns every `groundingChunks[].web` into a URL source (`extractSources`, `google-language-model.ts:1417`). The `uri` values are Google redirect URLs, not the original page URL (from Google docs, not visible here).

### G2. `url_context` (`google.tools.urlContext`)

**Where it runs:** Google's servers. Input schema is empty; the SDK comment: "Url context does not have any input schema, it will directly use the url from the prompt". Sent as `{urlContext: {}}`. The model reads URLs that appear in the prompt (or found by `googleSearch`); the result is `urlContextMetadata` on the candidate (retrieved URL plus a retrieval status). No page range or in-page search.

### G3. `enterprise_web_search`

Vertex-only compliance variant of `googleSearch`. No inputs, no outputs, no configuration (the file says so in comments).

---

## xAI

### X1. `web_search` (`xai.tools.webSearch`)

**Where it runs:** xAI servers. Model input empty. Developer config (`xai/src/tool/web-search.ts`): `allowedDomains` (max 5), `excludedDomains` (max 5), `enableImageSearch`, `enableImageUnderstanding`. Sent as `{type: 'web_search', allowed_domains, excluded_domains, enable_image_search, enable_image_understanding}` (`xai-responses-prepare-tools.ts:47-60`). The result schema is a copy of OpenAI's: `action` of `search` / `openPage` / `findInPage` plus `sources: [{type: 'url', url}]`. So xAI exposes the same three-action browsing design. Citations arrive as `url_citation` annotations (`xai-responses-language-model.ts:566-568`).

### X2. `x_search` (`xai.tools.xSearch`)

Searches X posts. Developer config: `allowedXHandles` (max 10), `excludedXHandles` (max 10), `fromDate`, `toDate`, `enableImageUnderstanding`, `enableVideoUnderstanding`. Result:

```ts
{ query: string; posts: Array<{ author: string; text: string; url: string; likes: number }> }
```

### X3. `view_image`, `view_x_video`

No inputs (`'no input parameters'`). Outputs: `{description: 'description of the image', objects?: 'objects detected in the image'}` and `{transcript?: 'transcript of the video', description: 'description of the video content', duration?: 'duration in seconds'}`. Relevant for checking claims that rest on an X video: the provider returns a transcript.

---

## AI Gateway tools (work with any model)

For these three tools the developer's config and the model's arguments overlap: the developer can preset any field, and the docs say for Tako "These defaults override values the model includes in a tool call" (`00-ai-gateway.mdx:995`). The top-level description string the model sees is set on Vercel's server and is not in this repo; the docs' one-line summaries are given instead.

### V1. `exa_search` (`gateway.tools.exaSearch`)

Docs: "The Exa Search tool enables models to search the web using [Exa's Search API](...). This tool is executed by the AI Gateway and returns token-efficient web excerpts for agent workflows."

**Model-facing parameters** (`gateway/src/tool/exa-search.ts`, `.describe()` text verbatim):

| Param | Type | Description |
|---|---|---|
| `query` | string, required | "Natural-language web search query. This is required." |
| `type` | `auto \| fast \| instant` | "Search method. Use auto for the default balance of speed and quality." |
| `num_results` | number | "Maximum number of results to return (1-100, default: 10)." |
| `category` | `company \| people \| research paper \| news \| personal site \| financial report` | "Optional content category to focus results." |
| `user_location` | string | "Two-letter ISO country code such as 'US'." |
| `include_domains` | string[] | "Only return results from these domains." |
| `exclude_domains` | string[] | "Exclude results from these domains." |
| `start_published_date` | string | "Only return links published after this ISO 8601 date." |
| `end_published_date` | string | "Only return links published before this ISO 8601 date." |
| `contents` | object | "Controls extracted page content and freshness." Sub-fields (no descriptions): `text` (bool or `{max_characters, include_html_tags, verbosity: compact/standard/full, include_sections, exclude_sections}` with sections `header, navigation, banner, body, sidebar, footer, metadata`), `highlights` (bool or `{query, max_characters}`), `max_age_hours`, `livecrawl_timeout`, `subpages`, `subpage_target`, `extras: {links, image_links}` |

**Result:**

```ts
{
  requestId: string; searchType?: string; resolvedSearchType?: string;
  results: Array<{
    title: string; url: string; id: string;
    publishedDate?: string | null; author?: string | null; image?: string | null; favicon?: string | null;
    text?: string;                 // full page text when contents.text is on
    highlights?: string[];         // query-relevant excerpts
    highlightScores?: number[];
    summary?: string;
    subpages?: ExaSearchResult[];
    extras?: { links?: string[]; imageLinks?: string[] };
  }>;
  costDollars?: { total?: number; search?: Record<string, number> };
}
// or { error: 'api_error' | 'rate_limit' | 'timeout' | 'invalid_input' | 'configuration_error' | 'execution_error' | 'unknown', statusCode?, message }
```

Distinctive: the model itself chooses whether results include full text or query-focused highlights, and can ask for a `highlights.query` different from the search query, which is an in-page search done at search time. It can also restrict by publication date. The result reports its own dollar cost.

### V2. `parallel_search` (`gateway.tools.parallelSearch`)

Docs: "The Parallel Search tool enables models to search the web using [Parallel AI's Search API](...). This tool is optimized for LLM consumption, returning relevant excerpts from web pages that can replace multiple keyword searches with a single call."

**Model-facing parameters** (verbatim):

| Param | Type | Description |
|---|---|---|
| `objective` | string, required | "Natural-language description of the web research goal, including source or freshness guidance and broader context from the task. Maximum 5000 characters." |
| `search_queries` | string[] | "Optional search queries to supplement the objective. Maximum 200 characters per query." |
| `mode` | `one-shot \| agentic` | "Mode preset: \"one-shot\" for comprehensive results with longer excerpts (default), \"agentic\" for concise, token-efficient results for multi-step workflows." |
| `max_results` | number | "Maximum number of results to return (1-20). Defaults to 10 if not specified." |
| `source_policy.include_domains` | string[] | "Limit results to these domains. Use plain domain names only — e.g. example.com or sub.example.gov, or a bare extension like .edu. Do not include a scheme, path, or port (e.g. not https://example.com/page)." |
| `source_policy.exclude_domains` | string[] | "Exclude results from these domains. Use plain domain names only — [same text]" |
| `source_policy.after_date` | string | "Only include results published after this date. Use an ISO 8601 calendar date formatted YYYY-MM-DD (e.g. 2025-01-01); do not include a time." |
| `source_policy` | object | "Source policy for controlling which domains to include/exclude and freshness." |
| `excerpts.max_chars_per_result` | number | "Maximum characters per result." |
| `excerpts.max_chars_total` | number | "Maximum total characters across all results." |
| `excerpts` | object | "Excerpt configuration for controlling result length." |
| `fetch_policy.max_age_seconds` | number | "Maximum age in seconds for cached content. Set to 0 to always fetch fresh content." |
| `fetch_policy` | object | "Fetch policy for controlling content freshness." |

**Result:** `{searchId, results: [{url, title, excerpt, publishDate?, relevanceScore?}]}` (JSDoc: excerpt is "Extracted text excerpt/content from the page"), or an error object like Exa's.

Distinctive: the query is an **objective in prose**, not keywords. The search engine picks excerpts relevant to that objective from each page, so a fact-checker could pass the claim itself plus context and get back passages, not snippets.

### V3. `perplexity_search` (`gateway.tools.perplexitySearch`)

Docs: "The Perplexity Search tool enables models to search the web using [Perplexity's search API](...). This tool is executed by the AI Gateway and returns web search results that the model can use to provide up-to-date information."

**Model-facing parameters** (verbatim):

| Param | Type | Description |
|---|---|---|
| `query` | string or string[] | "Search query (string) or multiple queries (array of up to 5 strings). Multi-query searches return combined results from all queries." |
| `max_results` | number | "Maximum number of search results to return (1-20, default: 10)" |
| `max_tokens_per_page` | number | "Maximum number of tokens to extract per search result page (256-2048, default: 2048)" |
| `max_tokens` | number | "Maximum total tokens across all search results (default: 25000, max: 1000000)" |
| `country` | string | "Two-letter ISO 3166-1 alpha-2 country code for regional search results (e.g., 'US', 'GB', 'FR')" |
| `search_domain_filter` | string[] | "List of domains to include or exclude from search results (max 20). To include: ['nature.com', 'science.org']. To exclude: ['-example.com', '-spam.net']" |
| `search_language_filter` | string[] | "List of ISO 639-1 language codes to filter results (max 10, lowercase). Examples: ['en', 'fr', 'de']" |
| `search_after_date` | string | "Include only results published after this date. Format: 'MM/DD/YYYY' (e.g., '3/1/2025'). Cannot be used with search_recency_filter." |
| `search_before_date` | string | "Include only results published before this date. Format: 'MM/DD/YYYY' (e.g., '3/15/2025'). Cannot be used with search_recency_filter." |
| `last_updated_after_filter` | string | "Include only results last updated after this date. Format: 'MM/DD/YYYY' (e.g., '3/1/2025'). Cannot be used with search_recency_filter." |
| `last_updated_before_filter` | string | "Include only results last updated before this date. Format: 'MM/DD/YYYY' (e.g., '3/15/2025'). Cannot be used with search_recency_filter." |
| `search_recency_filter` | `day \| week \| month \| year` | "Filter results by relative time period. Cannot be used with search_after_date or search_before_date." |

**Result:** `{id, results: [{title, url, snippet, date?, lastUpdated?}]}`. With the default settings the "snippet" is up to 2,048 tokens of page text per result and up to 25,000 tokens in total, so this is much closer to "search plus read" than to Serper's one-line snippets.

### V4. `tako_search` (brief)

A structured-data search returning data "cards" with optional inline dataset rows. Its parameter descriptions talk about cost to the model directly, e.g. `include_contents`: "Inline rows for each data result. This adds a data surcharge based on row count and dataset source. To estimate cost, search with include_contents disabled and inspect cards.content.export_pricing. [...]". This is the only tool in the SDK whose schema asks the model to reason about money.

---

## Final answer and budget awareness in the AI SDK

- No final-answer tool is built in. The documented pattern is to define your own tool and stop on it: `stopWhen: hasToolCall('finalizeTask')` (`content/docs/08-migration-guides/26-migration-guide-5-0.mdx:1181`, `content/docs/03-agents/04-loop-control.mdx:94`), or use structured output.
- Budget: `stopWhen: isStepCount(n)` and `prepareStep` control the loop on the developer side; nothing is shown to the model. The only per-tool hard caps on the hosted web tools are Anthropic's `maxUses` and the advisor's `maxUses`; when they are hit the model receives an error result (`max_uses_exceeded`) and must continue without the tool.
