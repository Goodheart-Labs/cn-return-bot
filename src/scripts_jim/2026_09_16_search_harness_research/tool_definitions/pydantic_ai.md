# Pydantic AI: research tool definitions

Sources read (relative to the scratchpad `sdks/pydantic_pydantic-ai/pydantic_ai_slim/pydantic_ai/`):

- `common_tools/` — ready-made local tools that run in the harness process: `duckduckgo.py`, `tavily.py`, `web_fetch.py`, `exa.py`, `x_search.py`.
- `native_tools/__init__.py` — configuration classes for **native tools**, which is Pydantic AI's current name for provider-hosted ("built-in", "server-side") tools: `WebSearchTool`, `WebFetchTool`, `XSearchTool`, `CodeExecutionTool`, `AdvisorTool` and others. Pydantic AI does not define what the model sees for these; it translates the configuration into each provider's own tool type (`models/anthropic.py`, `models/openai.py`, `models/google.py`, `models/xai.py`, `models/openrouter.py`).
- `capabilities/web_search.py`, `capabilities/web_fetch.py` — the `WebSearch` and `WebFetch` **capabilities** (Pydantic AI's term for a bundle that adds tools and settings to an agent). They use the provider's native tool when the model has one and can fall back to a local tool.
- `_output.py`, `_agent_graph.py`, `messages.py` — the `final_result` output tool and the retry messages the model sees.

Pydantic AI ships no default system prompt. The only fixed model-facing text is in tool descriptions, the output tool, and retry messages.

## How Pydantic AI turns a function into what the model sees

`Tool(func, name=..., description=...)` (`tools.py` line 430) uses the explicit `description` if given, otherwise the docstring summary. Parameter descriptions are read from the docstring's `Args:` section by `griffe` (`_function_schema.py` line 153). All the common tools pass an explicit one-line description, so the model sees only that line plus the parameter descriptions.

A tool's return value is sent to the model as a string. A string is sent as is; anything else (a list of TypedDicts, a dict) is serialized to **JSON** (`messages.py` lines 1557–1567). Errors that the tool raises as `ModelRetry` come back to the model as a retry prompt: the message text followed by `\n\nFix the errors and try again.` (`messages.py` line 1822).

## Index

| Tool name the model sees | Constructor | Runs where | Research role |
|---|---|---|---|
| `duckduckgo_search` | `duckduckgo_search_tool()` | Harness process (`ddgs` library scrapes DuckDuckGo) | Search: title, URL, snippet |
| `tavily_search` | `tavily_search_tool(api_key)` | Harness process calling Tavily | Search: title, URL, snippet, score |
| `web_fetch` (local) | `web_fetch_tool()` | Harness process | Fetch a page as markdown, cut at 50,000 characters |
| `exa_search`, `exa_find_similar`, `exa_get_contents`, `exa_answer` | `ExaToolset` / `exa_*_tool` (deprecated) | Harness process calling Exa | Search with page text, similar pages, page text by URL, cited answer |
| `x_search` (local fallback) | `x_search_tool(model, native_tool)` | Nested model call (a Grok sub-agent) | Search X/Twitter through a sub-agent |
| `web_search` (native) | `WebSearchTool()` or `WebSearch()` capability | Provider's server | Provider-hosted search |
| `web_fetch` (native) | `WebFetchTool()` or `WebFetch()` capability | Provider's server (Anthropic `web_fetch`, Google `url_context`) | Provider-hosted fetch |
| `advisor` (native) | `AdvisorTool(model=...)` | Provider's server, nested model call | Ask a stronger model mid-generation |
| `final_result` | automatic when `output_type` is structured | Harness process (validation only) | The final-answer tool |
| `search_tools` | `ToolSearch` capability | Harness process | Discover deferred tools by keyword (tool discovery, not web research) |

---

## 1. `duckduckgo_search`

**Runs:** harness process. The `ddgs` library (formerly `duckduckgo_search`) scrapes DuckDuckGo's results; no API key.

**Description, verbatim** (`common_tools/duckduckgo.py` line 74):

```
Searches DuckDuckGo for the given query and returns the results.
```

**Parameters the model fills in:**

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `query` | string | yes | `The query to search for.` |

**Developer configuration:** `duckduckgo_client` (a `DDGS` instance) and `max_results` (`The maximum number of results. If None, returns results only from the first response.`).

**What happens** (lines 50–61): runs `DDGS().text(query, max_results=...)` in a worker thread and validates the result as a list of `{title, href, body}`. No truncation.

**What the model gets back** (JSON):

```json
[{"title":"Moderna COVID-19 Vaccine trial ...","href":"https://www.nejm.org/doi/full/10.1056/NEJMoa2035389","body":"The trial enrolled 30,420 volunteers who were randomly assigned ..."}, ...]
```

This is also the default local fallback of the `WebSearch` capability (`capabilities/web_search.py`, `local=True` resolves to `'duckduckgo'`).

## 2. `tavily_search`

**Runs:** harness process, `AsyncTavilyClient.search`.

**Description, verbatim** (`common_tools/tavily.py` line 255):

```
Searches Tavily for the given query and returns the results.
```

**Parameters the model fills in** (docstring `Args:`, lines 143–149):

| Name | Type | Required | Default | Description (verbatim) |
|---|---|---|---|---|
| `query` | string | yes | | `The search query to execute with Tavily.` |
| `search_depth` | "basic" \| "advanced" \| "fast" \| "ultra-fast" | no | "basic" | `The depth of the search.` |
| `topic` | "general" \| "news" \| "finance" | no | "general" | `The category of the search.` |
| `time_range` | "day" \| "week" \| "month" \| "year" \| null | no | null | `The time range back from the current date to filter results.` |
| `include_domains` | list of strings \| null | no | null | `List of domains to specifically include in the search results.` |
| `exclude_domains` | list of strings \| null | no | null | `List of domains to specifically exclude from the search results.` |

**Developer configuration** (factory docstring, lines 203–221, verbatim): "`max_results` is always developer-controlled and does not appear in the LLM tool schema. Other parameters, when provided, are fixed for all searches and hidden from the LLM's tool schema. Parameters left unset remain available for the LLM to set per-call." The factory removes fixed parameters from the schema by rewriting the function signature (lines 240–250). This is a clean pattern: the developer chooses which knobs the model may turn.

**What the model gets back:** a JSON list of `{title, url, content, score}` (lines 100–114). Tavily's `content` is a snippet chosen for relevance to the query. Everything else in Tavily's response (the optional answer, raw content, images) is dropped.

## 3. `web_fetch` (local)

**Runs:** harness process, with SSRF protection (`_ssrf.safe_download` refuses private and local addresses unless allowed).

**Description, verbatim** (`common_tools/web_fetch.py` line 357):

```
Fetches the content of a web page at the given URL and returns it as markdown or binary content.
```

**Parameters the model fills in:**

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `url` | string | yes | `The URL to fetch.` |

**Developer configuration** (`web_fetch_tool`, lines 305–345): `max_content_length` (default **50,000** characters, "~12,500 tokens"; `None` means no limit), `allow_local_urls` (default False), `timeout` (default 30 s), `max_download_bytes` (default 50 MiB), `allowed_domains`, `blocked_domains`, `headers`.

**What happens** (lines 95–171):

1. GET with `Accept: text/markdown, text/html;q=0.9, */*;q=0.8`. The factory docstring explains why: "By default, sends `Accept: text/markdown` to request markdown directly from servers that support it (e.g. Cloudflare, Vercel, Mintlify). This reduces token usage and improves content quality. Falls back to HTML-to-markdown conversion when the server doesn't support markdown responses."
2. Network errors, HTTP error statuses and domain-filter violations raise `ModelRetry(f'Failed to fetch {url}: {e}')`. The model sees for example `Failed to fetch https://example.com/x: Client error '403 Forbidden' for url '...'` followed by `Fix the errors and try again.` There is no fallback to an archive or a browser.
3. By content type:
   - `text/markdown`: returned as is.
   - `text/html` or no type: BeautifulSoup + `markdownify`, stripping `img`, `script` and `style`. Navigation, headers and footers are **kept**. The `<title>` is extracted separately.
   - `application/json`: pretty-printed inside a ```` ```json ```` fence.
   - other text types: as is.
   - **binary types (PDF, images)**: returned as `BinaryContent`, so the model receives the actual file and reads it natively if it supports that media type. This is the only fetch tool in this survey that hands a PDF to the model as a document rather than as extracted text.
4. Runs of three or more newlines become two, then the text is cut at `max_content_length` with `\n\n[Content truncated]` appended. The model has no way to request later parts of the page.

**What the model gets back** (JSON):

```json
{"url":"https://example.org/article","title":"Trial results | Example","content":"Skip to content\n\n* [Home](/)\n...\n# Trial results\n\nThe trial enrolled 30,420 volunteers ...\n\n[Content truncated]"}
```

## 4. Exa tools (deprecated in favour of the separate "Pydantic AI Harness" package)

The module docstring says these "are deprecated and will be removed in v3. Use the `ExaSearch` capability from the [Pydantic AI Harness]". That separate package is not in the scratchpad, so I could not read its tool definitions.

**Runs:** harness process, `exa_py.AsyncExa`.

| Tool | Description, verbatim | Model parameters (verbatim descriptions) | Returns (JSON) |
|---|---|---|---|
| `exa_search` | `Searches Exa for the given query and returns the results with content. Exa is a neural search engine that finds high-quality, relevant results.` | `query`: `The search query to execute with Exa.`; `search_type` ('auto' \| 'keyword' \| 'neural' \| 'fast' \| 'deep', default 'auto'): `The type of search to perform. 'auto' automatically chooses the best search type, 'keyword' for exact matches, 'neural' for semantic search, 'fast' for speed-optimized search, 'deep' for comprehensive multi-query search.` | list of `{title, url, published_date, author, text}` |
| `exa_find_similar` | `Finds web pages similar to a given URL. Useful for discovering related content, competitors, or alternative sources.` | `url`: `The URL to find similar pages for.`; `exclude_source_domain` (default true): `Whether to exclude results from the same domain as the input URL. Defaults to True.` | same list |
| `exa_get_contents` | `Gets the full text content of specified URLs. Useful for reading articles, documentation, or any web page when you have the exact URL.` | `urls`: `A list of URLs to get content for.` | list of `{url, title, text, author, published_date}` |
| `exa_answer` | `Generates an AI-powered answer to a question with citations from web sources. Returns a comprehensive answer backed by real sources.` | `query`: `The question to answer.` | `{answer, citations: [{url, title, text}]}` |

**Developer configuration:** `num_results` (default **5**) and `max_characters` (per-result text cap, default **None = no limit**). So by default `exa_search` returns five full page texts in one tool result. `exa_get_contents` has no cap at all. Note that search results carry `published_date` and `author`, which Serper snippets do not.

## 5. `x_search` (local fallback through a sub-agent)

**Runs:** as a **nested model call**. A fresh Pydantic AI `Agent` on an xAI model with the native `XSearchTool` runs the query.

**Description, verbatim** (`common_tools/x_search.py` line 114): `Search X/Twitter for posts and content based on the given query.`

**Parameter:** `query`: `The search query to run on X/Twitter.`

**Sub-agent instructions, verbatim** (default, line 66): `Search X/Twitter based on the user query. Return a comprehensive summary of the results.`

**Returns:** the sub-agent's text answer. Failures become a `ModelRetry`.

## 6. Native `web_search` (`WebSearchTool`)

**Runs:** on the provider's server. Pydantic AI only sends configuration; the model-facing description is the provider's own and is not in this repo.

**Developer configuration** (`native_tools/__init__.py` lines 139–231; none of these are filled in by the model): `search_context_size` ('low' \| 'medium' \| 'high', default 'medium'; OpenAI Responses and OpenRouter only), `user_location`, `blocked_domains`, `allowed_domains`, `max_uses` (Anthropic and OpenRouter only: "If provided, the tool will stop searching the web after the given number of uses."), `external_web_access` (OpenAI only: "If `False`, the tool uses only cached or indexed results.").

**How it is translated per provider:**

| Provider | What is sent | File and line |
|---|---|---|
| Anthropic | `{name: "web_search", type: "web_search_20260209"}` on models whose profile supports dynamic filtering, otherwise `web_search_20250305`; with `max_uses`, domain lists, `user_location` | `models/anthropic.py` lines 1795–1816 |
| OpenAI Responses | `{type: "web_search", search_context_size, user_location, filters: {allowed_domains, blocked_domains}, external_web_access}` | `models/openai.py` lines 3046–3066 |
| Google | `{google_search: {}}` (no options) | `models/google.py` line 776 |
| xAI | `web_search(excluded_domains, allowed_domains, enable_image_understanding=False, user_location_*)` | `models/xai.py` lines 1256–1268 |
| OpenRouter | `{type: "openrouter:web_search", parameters: {search_context_size, user_location, allowed_domains, excluded_domains, max_uses}}` | `models/openrouter.py` lines 970–983 |

On Anthropic, when either web tool uses the 20260209 version, Pydantic AI also expects code-execution blocks in the response, because those versions run "dynamic filtering" code on Anthropic's server (lines 1722–1726). See `anthropic_server_tools.md` for what that means.

The `WebSearch` capability (`capabilities/web_search.py`) chooses between native and local. Domain filters, `max_uses` and `external_web_access=False` require the native tool (`_requires_native`, end of file); otherwise a model without native search can fall back to `duckduckgo_search`.

## 7. Native `web_fetch` (`WebFetchTool`)

**Runs:** provider's server. Supported by Anthropic and Google only.

**Developer configuration** (lines 384–440): `max_uses`, `allowed_domains`, `blocked_domains`, `enable_citations` (Anthropic: "If True, enables citations for fetched content."), `max_content_tokens` (Anthropic: "Maximum content length in tokens for fetched content.").

**Translation:** Anthropic gets `{name: "web_fetch", type: "web_fetch_20260209"}` (or `web_fetch_20250910` with the `web-fetch-2025-09-10` beta header) with `citations: {enabled: true}` when asked (`models/anthropic.py` lines 1818–1846). Google gets `{url_context: {}}` (`models/google.py` line 778). The `WebFetch` capability falls back to the local `web_fetch` tool above when the model has no native fetch; then citations and `max_content_tokens` are ignored.

## 8. Native `advisor` (`AdvisorTool`)

**Runs:** on the provider's server as a nested model call. "A native tool that lets a faster executor model consult a stronger advisor model mid-generation." Configuration: `model` (required), `max_uses` (per request, not per run), `max_tokens` (at least 1024), `caching`. Sent to Anthropic as its advisor tool and to OpenRouter as `openrouter:advisor` with `forward_transcript: False` (`models/openrouter.py` around line 960). The model-facing description is the provider's and is not in this repo.

## 9. `final_result` — the final-answer tool

**Runs:** harness process. Nothing is executed; the arguments are validated against the output type.

When the developer sets a structured `output_type` (a Pydantic model, a TypedDict, a dataclass) and uses the default "tool output" mode, Pydantic AI adds an **output tool** (`_output.py` lines 71–72 and 1414–1480):

- Name: `final_result`. If there are several output types, one tool per type: `final_result_<TypeName>`.
- Description: the output type's docstring if it has one, otherwise, verbatim:

  ```
  The final response which ends this conversation
  ```

  With several types and no docstring: `<TypeName>: The final response which ends this conversation`.
- Parameters: the JSON schema of the output type, including each field's description.

If the arguments fail validation, the model gets the validation errors as JSON followed by `Fix the errors and try again.` and must call `final_result` again. If the model answers with plain text when only the output tool is allowed, it receives a retry prompt built at `_agent_graph.py` lines 2216–2240, for example:

```
Please include your response in a tool call.
```

(or `Please return text or include your response in a tool call.` / `Please call a tool.` depending on what is allowed).

With the default `end_strategy='graceful'` (`_agent_graph.py` lines 112–139), function tools that the model emitted before `final_result` in the same response still run, then the first successful output tool ends the run. If one of those function tools raises `ModelRetry`, the output is discarded and the retry goes back to the model. With `'early'`, the other tool calls are skipped.

## Budget and time awareness

No tool tells the model its budget or the time. `max_uses` on native tools is enforced by the provider, not shown to the model by Pydantic AI. Usage limits (`UsageLimits`: request, tool-call and token caps) stop the run with an exception; the model is not told.

## What is distinctive

- **Native-or-local capabilities:** one `WebSearch()` / `WebFetch()` declaration uses the provider's hosted tool when the model has one and a local tool otherwise. The same agent code therefore gets very different tools depending on the model.
- **Developer-fixed parameters disappear from the schema** (`tavily_search_tool`): a clean way to stop the model from turning knobs it should not touch.
- **Local `web_fetch` asks the server for markdown first** (`Accept: text/markdown`) and returns **binary files (PDFs) to the model as documents** rather than as extracted text.
- The final answer is a real tool (`final_result`) whose schema is the developer's output type. This is where fields like a verdict, a note text or source URLs would go.
- Errors come back as retry prompts ending in `Fix the errors and try again.`, which invites the model to try another URL.
