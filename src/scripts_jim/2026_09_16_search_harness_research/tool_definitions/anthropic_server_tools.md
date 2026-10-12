# Anthropic server tools: web_search, web_fetch, code_execution

Sources, read on 2026-09-23:

- The Python SDK types in `scratchpad/sdks/anthropic/anthropic-sdk-python/src/anthropic/types/` (the TypeScript SDK at commit `d103182`, 2026-09-15, has the same shapes). Paths below are relative to that `types/` folder.
- The Anthropic docs pages [web-search-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [web-fetch-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool), [server-tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools), [code-execution-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool) and [programmatic-tool-calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling), read with WebFetch.
- A leaked claude.ai system prompt (`scratchpad/sdks/system_prompts_leaks/Anthropic/claude-opus-5.md`). It contains the model-facing `web_search` and `web_fetch` definitions that the claude.ai consumer app uses. That is **not** the API, and it is unofficial. I include it because it is the only place where the model-facing wording of these tools can be read at all.

"Server tool" is Anthropic's term. It means a tool that Anthropic's API runs itself, inside the same `/v1/messages` request. You do not execute it and you do not send back a `tool_result`. The model's call shows up as a `server_tool_use` block (id prefix `srvtoolu_`), and the result block follows in the same assistant turn. The API runs a server-side agent loop. On a long turn it may stop with `stop_reason: "pause_turn"`, and you continue by sending the assistant content back unchanged.

## Index

| Tool | Type strings (versions) | Where it runs | What the model fills in | Result the model gets | Price |
|---|---|---|---|---|---|
| `web_search` | `web_search_20250305`, `web_search_20260209` (dynamic filtering), `web_search_20260318` (adds `response_inclusion`) | Anthropic's servers; from 20260209 on, by default called from inside a code execution sandbox | `query` | A list of results: `url`, `title`, `page_age`, and `encrypted_content` (the page text, opaque to you). Always citable. | $10 per 1,000 searches plus tokens |
| `web_fetch` | `web_fetch_20250910`, `web_fetch_20260209` (dynamic filtering), `web_fetch_20260309` (adds `use_cache`), `web_fetch_20260318` (adds `response_inclusion`) | Anthropic's servers; from 20260209 on, optionally through code execution | `url` | One `document` block: the full page as plain text, or a PDF as base64. Truncated only if the developer set `max_content_tokens`. Citations are optional. | Tokens only |
| `code_execution` | `code_execution_20250522` (legacy, Python only), `code_execution_20250825` (bash + file editor), `code_execution_20260120` (REPL state and programmatic tool calling), `code_execution_20260521` (same runtime, but the description tells the model about the 90 s cell limit) | Anthropic sandbox container, no internet access | Sub-tools: `bash_code_execution` with `command`; `text_editor_code_execution` with `command` = `view` / `create` / `str_replace`; for programmatic tool calling, Python `code` | stdout, stderr, return code; file views with line numbers | Free when a 20260209+ web tool is in the request; otherwise billed by container time |

---

## 1. `web_search`

**Where it runs:** on Anthropic's servers. The search backend is not named in the docs. The leaked claude.ai prompt says "web_search uses a search engine and returns the top 10 results".

- With `web_search_20250305`, the model calls it directly.
- With `web_search_20260209` and later, `allowed_callers` defaults to `["code_execution_20260120"]`. This means the model is steered to call search from Python code inside a code execution container, filter the results there, and print only what it needs. Anthropic calls this **dynamic filtering**. Setting `allowed_callers: ["direct"]` turns it off. That setting is also required for ZDR (Zero Data Retention) and for models without programmatic tool calling.

### Description (model-facing)

The model-facing description of the API tool is **not public**. The API only takes `{"type": "web_search_…", "name": "web_search"}` and adds its own definition and instructions.

The closest public text is the claude.ai consumer app's definition in the leaked prompt (`claude-opus-5.md`, around line 3063). It is unofficial and belongs to a different product surface:

```
## web_search

Search the web
```

```json
{
  "name": "web_search",
  "parameters": {
    "additionalProperties": false,
    "properties": {
      "query": {
        "description": "Search query",
        "title": "Query",
        "type": "string"
      }
    },
    "required": [
      "query"
    ],
    "title": "AnthropicSearchParams",
    "type": "object"
  }
}
```

### Parameters

**What the model fills in:** only `query` (a string). The docs example is `"input": {"query": "claude shannon birth date"}`. A query that is too long returns the error `query_too_long`.

**What the developer sets** (verbatim docstrings from `web_search_tool_20260318_param.py`; the 20250305 and 20260209 files are identical except that they lack `response_inclusion`):

| Field | Type | Docstring (verbatim) |
|---|---|---|
| `name` | `"web_search"` (required) | "Name of the tool. This is how the tool will be called by the model and in `tool_use` blocks." |
| `type` | `"web_search_20250305"` / `"web_search_20260209"` / `"web_search_20260318"` (required) | none |
| `allowed_callers` | list of `"direct"`, `"code_execution_20250825"`, `"code_execution_20260120"`, `"code_execution_20260521"` | none in the SDK. The docs say it defaults to `["direct"]` on 20250305 and to `["code_execution_20260120"]` on 20260209+ |
| `allowed_domains` | list[str] or null | "If provided, only these domains will be included in results. Cannot be used alongside `blocked_domains`." |
| `blocked_domains` | list[str] or null | "If provided, these domains will never appear in results. Cannot be used alongside `allowed_domains`." |
| `cache_control` | object or null | "Create a cache control breakpoint at this content block." |
| `defer_loading` | bool | "If true, tool will not be included in initial system prompt. Only loaded when returned via tool_reference from tool search." |
| `max_uses` | int or null | "Maximum number of times the tool can be used in the API request." |
| `response_inclusion` (20260318 only) | `"full"` / `"excluded"` | "How this tool's result blocks appear in the API response when the result was consumed by a completed code_execution call in the same turn. 'full' returns the complete content (default). 'excluded' drops the nested server_tool_use and result block pair entirely. Results from direct calls, or from code_execution calls that paused before completing, are always returned in full so they can be sent back on the next turn." |
| `strict` | bool | "When true, guarantees schema validation on tool names and inputs" |
| `user_location` | `{type: "approximate", city?, region?, country?, timezone?}` | "Parameters for the user's location. Used to provide more relevant search results." |

The domain rules, quoted from the server-tools page:

```
* Domains should not include the HTTP/HTTPS scheme (use `example.com` instead of `https://example.com`).
* Subdomains are automatically included (`example.com` covers `docs.example.com`).
* Specific subdomains restrict results to only that subdomain (`docs.example.com` returns only results from that subdomain, not from `example.com` or `api.example.com`).
* Subpaths are supported for web search and match anything after the path (`example.com/blog` matches `example.com/blog/post-1`).
* Web fetch matches on the domain only: an entry that includes a path never matches a web fetch URL.
* You can use either `allowed_domains` or `blocked_domains`, but not both in the same request.
```

### What it does when called

The implementation runs on Anthropic's side, so the following comes from the docs and the SDK types.

- **Result shape** (`web_search_result_block.py`): each result is `{type: "web_search_result", url, title, page_age?, encrypted_content}`. The whole result is a list of these (`web_search_tool_result_block_content.py`: `Union[WebSearchToolResultError, List[WebSearchResultBlock]]`). The **page content the model reads is in `encrypted_content`**. You cannot read it, and you must pass it back unchanged on later turns: "The API decrypts that content on later turns to restore the search results in Claude's context. If `encrypted_content` is missing or modified, the request fails with a 400 validation error."
- **Number of results:** not stated in the API docs. The leaked claude.ai prompt says the top 10.
- **No results:** "A search that succeeds but matches no results returns an empty `content` list, not an error."
- **Errors** (`web_search_tool_result_error_code.py`): `invalid_tool_input`, `unavailable`, `max_uses_exceeded`, `too_many_requests`, `query_too_long`, `request_too_large`. These come back inside a normal HTTP 200 response as `{"type": "web_search_tool_result_error", "error_code": "max_uses_exceeded"}`, so the model sees the error and carries on.
- **Budget:** the only hard budget is `max_uses`. If the model goes over it, it gets `max_uses_exceeded` as the tool result. The docs give this sizing hint: "Simple factual queries typically use 1–3 searches; comparative or multientity research can use 10 or more." Usage is reported as `usage.server_tool_use.web_search_requests`. An error is not billed.
- **Citations** are always on. Each one is a `web_search_result_location` with `url`, `title`, `encrypted_index`, and `cited_text`. `cited_text` is "Up to 150 characters of the cited content", and "The web search citation fields `cited_text`, `title`, and `url` do not count toward input or output token usage."

Example response, verbatim from the docs:

```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
  "name": "web_search",
  "input": { "query": "claude shannon birth date" }
},
{
  "type": "web_search_tool_result",
  "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
  "content": [
    {
      "type": "web_search_result",
      "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
      "title": "Claude Shannon - Wikipedia",
      "encrypted_content": "EqgfCioIARgBIiQ3YTAwMjY1Mi1mZjM5LTQ1NGUtODgxNC1kNjNjNTk1ZWI3Y...",
      "page_age": "April 30, 2025"
    }
  ]
},
{
  "text": "Claude Shannon was born on April 30, 1916, in Petoskey, Michigan",
  "type": "text",
  "citations": [
    {
      "type": "web_search_result_location",
      "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
      "title": "Claude Shannon - Wikipedia",
      "encrypted_index": "Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..",
      "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician, electrical engineer, computer scientist, cryptographer and i..."
    }
  ]
}
```

**How citations probably work inside the model (inferred from the leaked claude.ai prompt).** The claude.ai citation instructions tell the model to wrap each claim in `<cite index="DOC_INDEX-SENTENCE_INDEX">` tags, or `DOC_INDEX-START:END` for a span of sentences. This means search results reach the model already split into documents and numbered sentences. The model cites sentence ranges, and the API turns those indices into `cited_text` plus `encrypted_index`. The API docs do not describe this. It fits the 150-character `cited_text` and the opaque `encrypted_index`.

**Dynamic filtering** (20260209+). From the docs: "With basic web search, every search result is loaded into Claude's context window, and much of that content can be irrelevant to the request. With `web_search_20260209` or later, Claude instead writes and runs code that filters the results first, so only relevant content reaches the context window."

- The mechanism is programmatic tool calling. From the programmatic-tool-calling page: "Tools that allow a code execution caller are exposed to Claude's code as async Python functions … Each function takes a single dict of arguments and returns a string … parses results that it needs as structured data, for example `rows = json.loads(await query_database({"sql": "<sql>"}))`." It also says: "Tool results from programmatic calls are not added to Claude's context - only the final code output is".
- The exact string that `web_search(...)` returns inside the sandbox is **not documented**.
- The SDK has a separate result type for this case, `EncryptedCodeExecutionResultBlock`, whose docstring reads "Code execution result with encrypted stdout for PFC + web_search results." It has an `encrypted_stdout` field. So when the code prints filtered search content, **the developer cannot read what the model read either**.
- Each nested call carries `caller: {type: "code_execution_20260120", tool_id: "srvtoolu_…"}`.
- Code execution used this way is free. The docs say "There are no additional charges for code execution calls made this way beyond the standard token costs."
- Supported on Claude 4.6 and later models.

### Prompt rules

The API adds its own hidden system instructions when the tool is present; these are not public. The docs describe the resulting behaviour:

```
Claude searches when the request depends on information that is current, changing, or outside its training data:
* Recent events, news, or announcements
* Current prices, rates, scores, or statistics
* Information about specific organizations, people, or products that might have changed
* Explicit requests to search or look something up

Claude answers directly without searching when the request draws on stable knowledge:
...
Triggering is steerable through your system prompt: you can encourage Claude to search more readily or to prefer answering directly. For a hard constraint, use `max_uses` to cap the number of searches for each request.
```

The claude.ai consumer prompt (leaked, unofficial, `claude-opus-5.md` lines 1215–1265) carries a much longer rulebook. These are the lines relevant to fact-checking research:

```
2. **Scale tool calls to complexity**: 1 for a single fact; 3–8 for medium tasks; 8–20 for deeper or broader questions ... When the request or your search plan covers multiple distinct items, search for each one separately rather than combining them into one query; a combined query returns surface-level results for all of them. ... Stop when every part of the answer is grounded in something you retrieved. Before writing the answer, check each part of the request against what you retrieved. ... When more than one answer could fit what you have found so far, use searches to rule the alternatives in or out against the most specific facts available, rather than only gathering more support for the one you currently favor; the most specific detail in the request is usually the thing to check, not a side note to set aside.
```

```
How to search:
- Queries short and specific, 1-6 words. Start broad (1-2 words), then narrow.
- Every query should be meaningfully different from previous ones; repeating the same phrasing won't change the results. If a query misses, reformulate it with different terms, a more specific source, or a different angle and try again.
- If a requested source isn't in results, say so.
- Today's date is July 24, 2026. Include year/date for specific dates; use 'today' for current info ('news today').
- Use web_fetch for full page content, since search snippets are often too brief (e.g. after searching news, web_fetch the article).
...
- Favor original sources (company blogs, peer-reviewed papers, gov sites, SEC) over aggregators; skip low-quality sources like forums unless specifically relevant.
```

---

## 2. `web_fetch`

**Where it runs:** on Anthropic's servers. From 20260209 on, the fetch can also be called from inside the code execution container, so that the model filters the page before reading it. Unlike web search, the docs do not say that 20260209+ web fetch defaults `allowed_callers` to code execution. The server-tools page says "The `_20260209` versions of the web tools default to the code execution caller only", which suggests it does.

### Description (model-facing)

**Not public for the API.** The claude.ai consumer app's definition is in the leaked prompt (`claude-opus-5.md`, lines 2932–3061). It is unofficial. I quote it because it shows the rules the model is given:

```
## web_fetch

Fetch the contents of a web page at a given URL.  
Only URLs that already appear in this conversation can be fetched: ones the person provided, or ones returned by a prior web_search or web_fetch. A URL recalled from training or built by editing a seen URL's path will be rejected; call web_search or fetch a linking page instead.  
This tool cannot access content that requires authentication, such as private Google Docs or pages behind login walls.  
Do not add www. to URLs that do not have them.  
URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.
```

The same leaked schema also lists the fetcher's internal options, which the model sees as parameters in that product: `allowed_domains`, `blocked_domains`, `html_extraction_method` ("'markdown' produces better content extraction than the legacy 'traf' method."), `is_zdr`, `text_content_token_limit` ("Truncate text to be included in the context to approximately the given number of tokens. Has no effect on binary content."), `url`, `web_fetch_pdf_extract_text` ("If true, extract text from PDFs. Otherwise return raw Base64-encoded bytes."), `web_fetch_rate_limit_dark_launch`, and `web_fetch_rate_limit_key` ("Rate limit key for limiting non-cached requests (100/hour)."). Only `url` is required. The rest look like operator knobs that leaked into the model-visible schema. `traf` is probably the trafilatura extraction library (inferred).

### Parameters

**What the model fills in:** `url` (the docs example is `"input": {"url": "https://example.com/article"}`). The maximum URL length is 250 characters (error `url_too_long`). The model has no parameter for an offset, a page number, or a search inside the page.

**What the developer sets** (verbatim docstrings from `web_fetch_tool_20260318_param.py`):

| Field | Type | Versions | Docstring (verbatim) |
|---|---|---|---|
| `name` | `"web_fetch"` | all | "Name of the tool. This is how the tool will be called by the model and in `tool_use` blocks." |
| `type` | `"web_fetch_20250910"` / `"_20260209"` / `"_20260309"` / `"_20260318"` | all | none |
| `allowed_callers` | list | all | none (see above) |
| `allowed_domains` | list[str] or null | all | "List of domains to allow fetching from" |
| `blocked_domains` | list[str] or null | all | "List of domains to block fetching from" |
| `cache_control` | object or null | all | "Create a cache control breakpoint at this content block." |
| `citations` | `{enabled: bool}` or null | all | "Citations configuration for fetched documents. Citations are disabled by default." |
| `defer_loading` | bool | all | "If true, tool will not be included in initial system prompt. Only loaded when returned via tool_reference from tool search." |
| `max_content_tokens` | int or null | all | "Maximum number of tokens used by including web page text content in the context. The limit is approximate and does not apply to binary content such as PDFs." |
| `max_uses` | int or null | all | "Maximum number of times the tool can be used in the API request." |
| `strict` | bool | all | "When true, guarantees schema validation on tool names and inputs" |
| `url_sources` | `{user_input, client_tool_results, server_tool_results}` | all in the current SDK | "Which sources contribute to the set of URLs web fetch may fetch. Each key is a tagged variant: `user_input` is `all` or `none`; the two tool filters are `all`, `none`, `only` (only the named tools' results) or `except` (every result but the named tools'). A named tool must be declared in this request's `tools[]`." |
| `use_cache` | bool | 20260309, 20260318 | "Whether to use cached content. Set to false to bypass the cache and fetch fresh content. Only set to false when the user explicitly requests fresh content or when fetching rapidly-changing sources." |
| `response_inclusion` | `"full"` / `"excluded"` | 20260318 | same text as for web_search |

On `url_sources` (`web_fetch_url_sources_param.py`), the `server_tool_results` docstring adds: "only web_search and web_fetch results ever contribute." The docs web page does not mention `url_sources` yet. It exists only in the SDK.

`use_cache` looks like something the model would decide, because of the "Only set to false when the user explicitly requests…" wording. But in the SDK it is a field on the tool definition, and the docs example sets it in the `tools` array. So as far as the public material shows, the developer sets it, not the model.

### What it does when called

These notes come from the docs and the SDK types.

- **Page text:** "The API retrieves the full text content from the specified URL." The result is a `document` block with `source: {type: "text", media_type: "text/plain", data: "…"}`. So the model gets plain text, not markdown (the leaked claude.ai schema shows an extraction method that can be set to markdown). The block also has a `title`.
- **PDFs:** "For PDFs, the API returns the content as base64-encoded data and processes it like a directly attached PDF document." So the model gets the PDF as a document with its page images and text. `max_content_tokens` does not apply to PDFs.
- **JavaScript:** "The web fetch tool currently does not support websites dynamically rendered with JavaScript."
- **Truncation:** there is no default. The whole page goes in unless the developer sets `max_content_tokens`, which truncates approximately. The docs give these size estimates: "Average web page (10 kB): \~2,500 tokens · Large documentation page (100 kB): \~25,000 tokens · Research paper PDF (500 kB): \~125,000 tokens". An error code `content_too_large` exists in the SDK but is not described in the docs.
- **Caching:** "The web fetch tool caches results … The content returned may not always reflect the latest version available at the URL." You can bypass the cache with `use_cache: false` from 20260309 on.
- **Timestamp:** each result has `retrieved_at` (ISO 8601).
- **The URL must already appear in the conversation.** This is the anti-exfiltration rule. From the docs: "the web fetch tool can only fetch URLs that have previously appeared in the conversation context. This includes: URLs in user messages · URLs in client-side tool results · URLs from previous web search or web fetch results. The tool cannot fetch URLs that appear only in Claude's own output or only in the system prompt." Results of code execution do not count either. A URL that looks like it contains a credential is refused unless the user supplied that credential. Breaking the rule returns `url_not_in_prior_context` or `url_not_allowed`.
- **Errors** (`web_fetch_tool_result_error_code.py` and the docs): `invalid_tool_input`, `url_too_long` ("URL exceeds maximum length (250 characters)"), `url_not_allowed` (domain filter, private addresses, `robots.txt`, credentials), `url_not_in_prior_context`, `url_not_accessible` ("Failed to fetch content (HTTP error)"), `unsupported_content_type` ("only text, HTML, and PDF"), `too_many_requests`, `max_uses_exceeded`, `unavailable`, `content_too_large`. The docs say: "Claude sees the error result and continues the turn."
- **Budget:** `max_uses` is the only limit. "Failed fetches count against the limit … There is currently no default limit." Usage is reported as `usage.server_tool_use.web_fetch_requests`. There is no per-fetch fee.
- **Citations** are opt-in (`citations: {enabled: true}`). Once enabled, the model's text carries `char_location` citations that point into the fetched document: `document_index`, `document_title`, `start_char_index`, `end_char_index`, `cited_text` (`citation_char_location.py`). These are exact character offsets into the page text, which a program can check mechanically.

Example, verbatim from the docs:

```json
{
  "type": "web_fetch_tool_result",
  "tool_use_id": "srvtoolu_01234567890abcdef",
  "content": {
    "type": "web_fetch_result",
    "url": "https://example.com/article",
    "content": {
      "type": "document",
      "source": {
        "type": "text",
        "media_type": "text/plain",
        "data": "Full text content of the article..."
      },
      "title": "Article Title",
      "citations": { "enabled": true }
    },
    "retrieved_at": "2025-08-25T10:30:00Z"
  }
},
{
  "text": "the main argument presented is that artificial intelligence will transform healthcare",
  "type": "text",
  "citations": [
    {
      "type": "char_location",
      "document_index": 0,
      "document_title": "Article Title",
      "start_char_index": 1234,
      "end_char_index": 1456,
      "cited_text": "Artificial intelligence is poised to revolutionize healthcare delivery..."
    }
  ]
}
```

**Dynamic filtering** (20260209+). From the docs: "With `web_fetch_20260209` or later, Claude can write and execute code to filter the fetched content before loading it into context." The listed uses are "Extracting specific sections from long documents · Processing structured data from web pages · Filtering relevant information from PDFs · Reducing token costs when working with large documents". **This is Anthropic's only "find inside a page" mechanism.** There is no find-in-page parameter. Instead, the model gets the page as a string inside Python and can slice it, regex over it, or search it with `rg` (ripgrep is installed in the container). Search and fetch "share a single execution container". Supported models listed: Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Mythos Preview, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6.

### Prompt rules

These are the docs' descriptions of the hidden behaviour:

```
Claude fetches when the request points at a specific page or document:
* A URL is provided in the conversation (or a previous tool result)
* The user names a specific resource (a particular article, README, pricing page, or documentation section) without a URL, and the web search tool is also enabled so Claude can locate it first

Claude does **not** fetch for general-knowledge or open-ended questions that don't reference a specific page.
```

```
When both the web search and web fetch tools are enabled ... In this workflow, Claude:
1. Uses web search to find relevant articles.
2. Selects the most promising results.
3. Uses web fetch to retrieve full content.
4. Provides detailed analysis with citations.
```

The docs recommend this system-prompt text for when a client-side shell also exists, because the web tools start a second execution environment:

```
When multiple code execution environments are available, be aware that:
- Variables, files, and state do NOT persist between different execution environments
- Use the code_execution tool for general-purpose computation in Anthropic's sandboxed environment
- Use client-provided execution tools (e.g., bash) when you need access to the user's local system, files, or data
- If you need to pass results between environments, explicitly include outputs in subsequent tool calls rather than assuming shared state
```

---

## 3. `code_execution`

**Where it runs:** in an Anthropic sandbox container, created per request unless you reuse one by passing its `container` id. It has no internet access. It is relevant here because it is the engine behind dynamic filtering, and because it gives the model tools for reading large text (a file viewer with line ranges, `rg`, Python, and PDF libraries).

### Description (model-facing)

**Not public.** The developer only sends `{"type": "code_execution_20250825", "name": "code_execution"}`, and "Both fields are fixed". The docs do say what the description of the newest version contains: "`code_execution_20260521` is the same runtime as `code_execution_20260120`. The difference is that the tool description tells Claude about the 90-second wall-clock limit on each Python cell in programmatic tool calling, so Claude can budget long-running cells." This is the only piece of time-budget awareness that Anthropic puts into a tool description, and it is about compute time, not research budget.

### Parameters

**Developer-set fields** (from `code_execution_tool_20260521_param.py`, the same for all versions): `name`, `type`, `allowed_callers`, `cache_control`, `defer_loading`, `strict`. There is nothing to configure beyond these.

**What the model fills in:** the tool presents itself as two sub-tools. Their inputs, from the docs' response examples:

- `bash_code_execution`: `{"command": "ls -la | head -5"}`
- `text_editor_code_execution`: `{"command": "view", "path": "config.json"}`, `{"command": "create", "path": "…", "file_text": "…"}`, `{"command": "str_replace", "path": "…", "old_str": "…", "new_str": "…"}`
- legacy `code_execution_20250522` and programmatic tool calling: `{"code": "<python>"}`. The docs example is `"code": "import json\n\nrows = json.loads(await query_database({'sql': '<sql>'}))\n..."`.

### What it does when called

- **Container:** Python 3.11, x86_64 Linux, 1 CPU, 5 GiB RAM, 5 GiB disk. "Internet access: Completely disabled for security". Containers expire 30 days after creation and are checkpointed after about 5 minutes idle. With programmatic tool calling, each REPL cell has a 90-second wall-clock limit. A pending programmatic tool call times out after about 4 minutes with a `TimeoutError` inside the code.
- **Libraries relevant to reading documents:** pypdf, pdfplumber, pypdfium2, pdf2image, tabula-py, pandas, and the CLI tools `rg` (ripgrep), `fd`, and `sqlite`.
- **Results:**
  - bash returns `{type: "bash_code_execution_result", stdout, stderr, return_code, content: [files]}`.
  - A file view returns `{type: "text_editor_code_execution_view_result", file_type, content, num_lines, start_line, total_lines}`. The line range fields make it a paged file reader.
  - A str_replace returns a diff (`old_start`, `old_lines`, `new_start`, `new_lines`, `lines`).
  - When code has consumed web_search results, the result may instead be `encrypted_code_execution_result` with `encrypted_stdout`.
- **Errors:** `unavailable`, `execution_time_exceeded`, `invalid_tool_input`, `too_many_requests` (all tools); `output_file_too_large` (bash); `file_not_found` (text editor).
- **Programmatic tool calling** (20260120+): any tool with `allowed_callers` containing a code execution version becomes `await tool_name({...})` inside Python and returns a string. Intermediate results stay out of the model's context. Only what the code prints comes back. The docs' own data-filtering example:

```python
server_id = "srv-01"
log_text = await fetch_logs({"server_id": server_id})
errors = [line for line in log_text.splitlines() if "ERROR" in line]
print(f"Found {len(errors)} errors")
for error in errors[-10:]:  # Only return last 10 errors
    print(error)
```

- **Price:** "Code execution is free when used with web search or web fetch" (20260209+). Otherwise it is billed by container time, with a 5-minute minimum, 1,550 free hours per organization per month, and $0.05 per hour after that.

### Prompt rules

The docs describe when Claude runs code:

```
Claude runs code when the request benefits from computation or file handling:
* Non-trivial math (large numbers, many steps, precision-sensitive results)
* Data analysis, file parsing, or visualization
* Algorithm execution or simulation
* Explicit requests to "run", "compute", or "execute"
```

---

## What stands out for our fact-checking bot

- **The search result shape hides the snippet from the developer.** The model sees page content that the developer cannot read (it is in `encrypted_content`), and the developer sees only url, title and `page_age`. We cannot copy what the model saw. But `page_age` is a useful field our Serper results do not always carry.
- **There is no truncation window by default.** Anthropic's web_fetch loads the whole page unless the developer sets `max_content_tokens`. Their answer to long pages is not pagination or find-in-page. It is "load the page into Python and let the model grep it" (dynamic filtering). Our 20,000-character cut has no counterpart on their side.
- **Citations are mechanical.** Web search citations come as sentence-index spans that the model emits and the API resolves (inferred from the leaked prompt). Web fetch citations are exact character offsets. Either way, the quote is guaranteed to exist in the source. That is the property our `verifier_citations` flow currently has to check after the fact.
- **The fetch URL allow-list is a real constraint.** The model may only fetch URLs it has already seen in the conversation. The leaked claude.ai prompt tells the model outright that "A URL recalled from training or built by editing a seen URL's path will be rejected". This is a security rule, but it also stops hallucinated URLs.
- **Budget awareness is weak.** `max_uses` is a hard cap that the model learns about only when it hits the `max_uses_exceeded` error. The docs say nothing about telling the model the remaining count. The only budget stated in a tool description is the 90-second cell limit in `code_execution_20260521`.
- **Surprises:**
  - Code whose stdout contains web_search content produces an **encrypted stdout** (`EncryptedCodeExecutionResultBlock`), so even dynamic-filtering output is hidden from the developer.
  - `url_sources` (which tool results may supply fetchable URLs) is in the SDK but not yet in the docs.
  - `use_cache` reads like a model instruction, but it is a developer field.
  - The fetched HTML reaches the model as `text/plain`, not markdown.
