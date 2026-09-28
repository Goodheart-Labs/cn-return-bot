# Strands Agents (AWS): research tool definitions

Sources read (all paths relative to the scratchpad `sdks/` folder):

- `strands/strands-py/src/strands/vended_tools/` — the tools that ship inside the core SDK today ("vended tools"): `web_fetch`, `http_request`, `sleep`, plus shell/file/notebook tools. The TypeScript twin lives in `strands/strands-ts/src/vended-tools/`.
- `strands/strands-py/src/strands/vended_plugins/context_offloader/` — the plugin that moves oversized tool results out of the context and gives the model a `retrieve_offloaded_content` tool (a grep-and-line-range reader).
- `strands-agents_tools/src/strands_tools/` — the older community package `strands-agents-tools`. Most of its web tools (`tavily_*`, `exa_*`, `http_request`, `think`, `current_time`) are marked deprecated there, with removal planned for v0.9.0, and the README points to the vended tools or to the vendors' MCP servers instead.

`strands-agents_sdk-python/` is the same monorepo checkout as `strands/`; I read from `strands/`.

Strands has no default system prompt and no prompt template that talks about tools. Everything the model learns about a tool comes from the tool's own description and parameter schema. There is no built-in "final answer" tool: the loop ends when the model replies without calling a tool. The only exception is the `stop` tool in the community package (below).

## How Strands turns a Python function into what the model sees

This matters because most tools below are plain decorated functions. The `@tool` decorator (`strands/strands-py/src/strands/tools/decorator.py`, lines 235–312) builds the tool spec like this:

- **Description** = the whole docstring *minus the `Args:` section*. `Returns:`, `Raises:`, `Examples:` and `Notes:` sections stay in. So a long docstring with usage examples is sent to the model word for word. If `@tool(description=...)` is given, that string replaces the docstring.
- **Parameter descriptions** = the text for each argument in the docstring's `Args:` section (parsed with `docstring_parser`), or `"Parameter <name>"` when missing.
- Parameters named `agent`, `self` or `cls`, and the `tool_context` parameter when `context=True`, are hidden from the model and filled in by the framework (line 448).

## Index

| Tool | Package | Runs where | Research role |
|---|---|---|---|
| `web_fetch` (agentic mode, the default) | core SDK, vended | Harness process, plus a nested model call (an "analyst" agent) | Fetch a page and answer a question about it; the page never enters the main context |
| `web_fetch` (markdown mode) | core SDK, vended | Harness process | Fetch a page as markdown, cut at 50,000 characters |
| `http_request` (vended) | core SDK, vended | Harness process | Raw HTTP call, returns status, headers and body |
| `retrieve_offloaded_content` | core SDK, `ContextOffloader` plugin | Harness process | Grep or read line ranges of a tool result that was too big to keep in context |
| `sleep` | core SDK, vended | Harness process | Wait up to 60 s (not research-relevant) |
| `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map` | community, deprecated | Harness process calling Tavily's API | Search, extract, crawl, site map |
| `exa_search`, `exa_get_contents` | community, deprecated | Harness process calling Exa's API | Search with optional page text, highlights and summaries; get contents by URL |
| `http_request` (community) | community, deprecated | Harness process | HTTP with auth, optional HTML→markdown |
| `think` | community, deprecated | Nested agent(s), one per cycle | Recursive "thinking cycles" run by a sub-agent |
| `use_agent` | community | Nested agent | Run a sub-agent with its own system prompt and tools |
| `current_time` | community, deprecated | Harness process | Current time in ISO 8601 |
| `stop` | community | Harness process | End the event loop |

Coding/shell tools in the core SDK (`shell`, `file_editor`, `notebook`, `_bash`) are not covered here.

---

## 1. `web_fetch` — agentic mode (the default)

**Runs:** in the harness process (an `httpx` GET), then a **nested model call**: a fresh Strands `Agent` (the "analyst") reads the page and answers the model's `prompt`. The analyst uses a model given to the factory, otherwise the calling agent's own model.

**Description, verbatim** (`strands/strands-py/src/strands/vended_tools/web_fetch/types.py`, lines 10–15):

```
Fetches an HTTP(S) URL and answers a prompt about its content. The analyst processes the page directly so the full content never enters the main agent's context. The prompt parameter is required.
```

**Parameters the model fills in** (from the docstring `Args:` in `web_fetch.py` lines 142–151):

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `url` | string | yes | `The URL to fetch. Must be ``http://`` or ``https://``.` |
| `prompt` | string | yes | `The question or instruction about the page content.` |

The TypeScript version uses zod descriptions that differ slightly: `url` → `URL to fetch. Must be http:// or https://.`, `prompt` → `Question or instruction about the page content.` (`strands-ts/src/vended-tools/web-fetch/web-fetch.ts`, lines 32–35).

**Developer configuration** (`make_web_fetch`, `web_fetch.py` lines 56–95): `name` (default `"web_fetch"`), `description`, `max_bytes` (default 5 MiB), `max_content_chars` (default 50,000), `client` (an `httpx.AsyncClient`; without one, a new client is made per request with `follow_redirects=True` and httpx's default 5 s timeout), `model` (the analyst's model), `mode` (`"agentic"` or `"markdown"`).

**What happens when called** (`web_fetch.py` lines 136–189, `_fetch_once` lines 201–254, `_extract.py`):

1. One HTTP GET with the headers `User-Agent: strands-agents-web-fetch/1.0` and `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8`. There is no retry, no browser fallback and no archive fallback.
2. The body is streamed. If it passes `max_bytes` (5 MiB) the call fails with `Response body exceeded 5242880 bytes. Refusing to buffer more.` An HTTP status of 400 or more fails with `HTTP <code> <reason>`. A timeout fails with `Fetch timed out: '<url>'`.
3. If the content type contains `html` or `xml`, the page is converted to markdown: BeautifulSoup removes `<head>` and these elements: script, style, noscript, template, svg, canvas, iframe, object, embed, video, audio, form, input, button, select, textarea, **nav**. Inline `data:` images are replaced by their alt text. Then `markdownify` converts with ATX headings, and `# <page title>` is put on top.
4. The markdown is cut at `max_content_chars` (50,000) with the marker `\n\n[content truncated]` appended. There is no way for the model to read past that point.
5. A **new analyst agent** is built for every call (so nothing carries over between fetches) with this system prompt, verbatim (`web_fetch.py` lines 48–53):

   ```
   You answer a request about a single fetched web page. Use only the provided content; if it does not contain the answer, say so plainly. Be concise and factual, and preserve concrete details (names, numbers, quotes, links) relevant to the request.
   ```

   and this user message (line 184):

   ```
   URL: {url}

   Request: {prompt}

   --- Content ---
   {content}
   ```
6. The analyst's final text is returned as the tool result string. Errors are raised as `WebFetchError`, which Strands turns into an error tool result.

**Example of what the main model receives:** just the analyst's prose, for example `The article says the vaccine trial enrolled 30,420 participants ("30,420 volunteers were randomized…"). It does not mention efficacy in adults over 65.` The main model never sees the page, the URL list on it, or where on the page the answer came from.

**Prompt rules elsewhere:** none. Strands ships no system prompt.

## 2. `web_fetch` — markdown mode

Same factory with `mode="markdown"`. **Runs** entirely in the harness process.

**Description, verbatim** (`types.py` lines 3–7):

```
Fetches an HTTP(S) URL and returns its content as clean markdown. HTML pages are converted to markdown with scripts, styles, and noise stripped; other content types are returned as-is.
```

**Parameters:** only `url` (string, required, `The URL to fetch. Must be ``http://`` or ``https://``.`).

**What happens:** steps 1–4 above, then the markdown string is returned directly (`web_fetch.py` lines 108–134). A non-HTML body (JSON, plain text, a PDF decoded as text with replacement characters) is returned as decoded text without conversion. The limit is 50,000 characters, cut from the front, with `[content truncated]` at the end.

The community package's migration note (`strands-agents_tools/README.md` lines 281–285) says: "`web_fetch` defaults to an agentic mode that summarizes a page before it enters the main context; pass `mode="markdown"` to the `web_fetch` factory for the full page as markdown".

## 3. `http_request` (vended, core SDK)

**Runs:** harness process, thin wrapper over `httpx.AsyncClient`.

**Description, verbatim** (`vended_tools/http_request/types.py` lines 25–28):

```
Makes HTTP requests to external APIs. Supports GET, POST, PUT, DELETE, PATCH, HEAD, and OPTIONS methods. Returns response with status, headers, and body.
```

**Parameters** (docstring `Args:` in `http_request.py` lines 97–110):

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `method` | enum GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS | yes | `HTTP method (``GET``, ``POST``, ``PUT``, ``DELETE``, ``PATCH``, ``HEAD``, ``OPTIONS``).` |
| `url` | string | yes | `Absolute URL to request.` |
| `headers` | object of strings | no | `Optional request headers.` |
| `body` | string | no | `Optional request body as a string.` |
| `timeout` | number | no | `Optional per-request timeout in seconds. When a client is provided, capped at the client's configured timeout. When no client is provided, used as-is.` |

**Returns** a dict `{status, status_text, headers, body}` with the body as raw text. There is no HTML conversion and no size cap in the tool itself. The migration note says it is meant for APIs, and that pages belong to `web_fetch`.

## 4. `retrieve_offloaded_content` (ContextOffloader plugin)

This is Strands' answer to "a tool result is too big". It is the closest thing in Strands to in-page search, and it works on the output of *any* tool, including `web_fetch` in markdown mode.

**Runs:** harness process. It is registered automatically when the developer adds `ContextOffloader(...)` to the agent's plugins (`include_retrieval_tool=True` by default).

**What triggers it** (`vended_plugins/context_offloader/plugin.py` lines 468–635): after every tool call, the plugin counts the result's tokens with the model's tokenizer. If the count is above `max_result_tokens` (default **2,500**), each content block is stored (in memory, a file store, or another backend), and the result the model sees is replaced by a preview of the first `preview_tokens` (default **1,000** tokens, sliced as 4 characters per token = 4,000 characters) plus references. Entries are deleted 20 agent cycles after they were last stored or read (`evict_after_cycles`). Results of sub-agent delegation tools are never offloaded.

**What the model sees in place of a large result, verbatim template** (lines 577–596):

```
[Offloaded: {n} blocks, ~{token_count:,} tokens]
Tool result was offloaded to external storage due to size.
Use the preview below if it answers your question.
If you need more detail, use retrieve_offloaded_content with a reference and:
  - pattern: regex or keyword to find matching lines with context
  - line_range: { start, end } to read a specific span of lines
Retrieve full content (omit pattern/line_range) as a last resort.

{first ~4,000 characters}

[Stored references:]
  {tool_use_id}_0 (text, 58,211 chars)
```

**Description, verbatim** (the method docstring minus `Args:`, lines 377–400):

```
Retrieve offloaded content by reference.

When a tool result was too large to keep in context, it was stored externally and replaced with a preview
and a reference. Use this tool with that reference to access the stored content.

Returns:
  - With pattern: matching lines with line numbers and surrounding context
  - With line_range: the specified span of lines with line numbers
  - Without pattern/line_range: the full original content (use sparingly — re-injects all tokens)

Constraints:
  - pattern/line_range/context_lines only work on text content. For binary content, omit them.
  - Line numbers in results are 1-indexed and can be used in follow-up line_range calls.
  - Retrieving a reference refreshes its eviction timer for unified Storage
    backends, so actively-retrieved content survives ``evict_after_cycles``
    beyond its store time — matching ``InMemoryStorage.retrieve``'s
    last-access refresh behavior.

Examples:
  {"reference": "ref_1", "pattern": "error"} -> lines containing "error" with 5 lines context
  {"reference": "ref_1", "pattern": "error|warning", "context_lines": 3} -> regex, 3 lines context
  {"reference": "ref_1", "line_range": {"start": 10, "end": 25}} -> lines 10-25
  {"reference": "ref_1", "pattern": "TODO", "line_range": {"start": 1, "end": 50}} -> search within range

Raises:
    ValueError: If the reference is unknown, the content is binary and pattern/line_range/context_lines
        were supplied, or line_range falls outside the content.
```

**Parameters** (lines 401–408):

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `reference` | string | yes | `The reference string from the offload placeholder (e.g. "mem_1_tool-123_0").` |
| `pattern` | string | no | `Regex or keyword to grep for. Returns only matching lines with context — not the full content.` |
| `line_range` | object `{start: int, end: int}` | no | `Return only this span of lines. A dict with 'start' and 'end' keys (1-indexed). Combine with pattern to search within the range.` |
| `context_lines` | integer | no | `Lines before AND after each match (like grep -C). Default: 5. Without pattern/line_range, returns first N lines.` |

**What happens** (`context_offloader/search.py`): the pattern is compiled as a Python regex, **case-sensitive**, truncated to 200 characters, and falls back to a literal match if it does not compile or looks like a catastrophic nested quantifier. Every matching line plus `context_lines` lines on each side is printed with line numbers; matched lines get a `>` prefix and gaps are shown as `---`. Output is capped at `max_result_tokens × 4` characters (10,000 by default), cut at a line boundary. Example output:

```
[2 matches for /30,420/]

   41| The phase 3 trial began in July.
>  42| In total, 30,420 volunteers were randomized.
   43| ...
---
> 118| Of the 30,420 participants, 196 developed ...
```

No match returns `No matches found for pattern '30,420' (searched 812 lines).` A line range returns `[Lines 10-25 of 812]` followed by the numbered lines.

Note that "lines" here are the lines of the markdown. A long paragraph is one line, so a match returns the whole paragraph.

## 5. Community package: `tavily_search` (deprecated)

**Runs:** harness process, one POST to `https://api.tavily.com/search`. Needs `TAVILY_API_KEY`.

**Description, verbatim** (docstring minus `Args:`, `strands-agents_tools/src/strands_tools/tavily.py` lines 294–342):

```
Search the web for real-time information using Tavily's AI-optimized search engine.

Tavily is a search engine specifically optimized for LLMs and AI agents. It handles all the
complexity of searching, scraping, filtering, and extracting the most relevant information
from online sources in a single API call.

Key Features:
- Real-time web search with AI-powered relevance ranking
- Automatic content extraction and cleaning
- Support for both general and news search topics
- Advanced filtering and domain management
- Image search capabilities with descriptions
- Date range filtering for temporal queries

Search Types:
- general: Broader, general-purpose searches across various sources
- news: Real-time updates from mainstream media sources

Search Depth:
- basic: Provides generic content snippets (1 API credit)
- advanced: Tailored content snippets with better relevance (2 API credits)

Returns:
    Dict containing search results and metadata with status and content fields.
```

**Parameters (all filled by the model; verbatim descriptions from `Args:`):**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | `The search query to execute with Tavily. This should be a clear, specific question or search term. Examples: "What is machine learning?", "Latest news about climate change"` |
| `search_depth` | "basic" \| "advanced" | no | `The depth of the search ("basic" or "advanced")` |
| `topic` | "general" \| "news" | no | `The category of the search ("general" or "news")` |
| `max_results` | int | no | `Maximum number of search results to return (0-20)` |
| `auto_parameters` | bool | no | `When enabled, Tavily automatically configures search parameters based on query content and intent. May automatically use advanced search (2 credits)` |
| `chunks_per_source` | int | no | `Number of content chunks per source (1-3). Only available with advanced search depth. Chunks are 500-character snippets from each source` |
| `time_range` | day/week/month/year/d/w/m/y | no | `Filter results by time range ("day", "week", "month", "year" or shorthand "d", "w", "m", "y")` |
| `days` | int | no | `Number of days back from current date to include. Only available with news topic` |
| `start_date` / `end_date` | string | no | `Include results after this date (YYYY-MM-DD format)` / `Include results before this date (YYYY-MM-DD format)` |
| `include_answer` | bool \| "basic" \| "advanced" | no | `Include an LLM-generated answer (False, True/"basic", or "advanced")` |
| `include_raw_content` | bool \| "markdown" \| "text" | no | `Include cleaned HTML content (False, True/"markdown", or "text")` |
| `include_images`, `include_image_descriptions`, `include_favicon` | bool | no | image and favicon switches |
| `include_domains` / `exclude_domains` | list of strings | no | `List of domains to specifically include in results` / `List of domains to specifically exclude from results` |
| `country` | string | no | `Boost results from specific country (only with general topic). Examples: "united states", "canada", "united kingdom"` |

**What happens** (lines 343–413): parameters that are `None` are dropped, the rest is POSTed, and the raw JSON response is returned as `str(data)` — **a Python dict repr, not JSON** — inside `{"status": "success", "content": [{"text": ...}]}`. The model therefore sees something like `{'query': '...', 'answer': None, 'results': [{'url': '...', 'title': '...', 'content': '<snippet>', 'score': 0.83, 'raw_content': None}, ...], 'response_time': 1.2}`. There is no truncation, so `include_raw_content=True` with 20 results can put whole pages into context. The Rich panel with a 150-character raw-content preview is only printed to the console, not given to the model.

`tavily_extract` (`urls`, `extract_depth`, `format`, `include_images`, `include_favicon`), `tavily_crawl` and `tavily_map` (`url`, `max_depth`, `max_breadth`, `limit`, `instructions`, path/domain filters, `categories`) follow the same pattern: a long docstring as the description, a POST, and the raw response as a dict string. `tavily_crawl` and `tavily_map` accept a natural-language `instructions` parameter that steers which pages Tavily crawls.

## 6. Community package: `exa_search` and `exa_get_contents` (deprecated)

**Runs:** harness process, POST to `https://api.exa.ai/search` or `/contents`, header `x-exa-integration: aws-strands-agent`.

**`exa_search` description** (docstring minus `Args:`, `exa.py` lines 262–345) begins:

```
Search the web intelligently using Exa's advanced search capabilities.

Exa provides advanced web search optimized for LLMs and AI agents. The "auto" mode (default)
intelligently selects the best search approach to find the most relevant results for your query.
```

and continues with verbatim sections "Key Features", "Search Types" (auto / instant / fast / deep), "Categories (optional - general web search works best)" (company, research paper, news, pdf, github, personal site, linkedin profile, people, financial report), "Returns: Dict containing search results with title, URL, content, and metadata." and five worked Python examples, for instance:

```
# Search with highlights and content freshness
result = await exa_search(
    query="AI safety research advances",
    highlights={"maxCharacters": 4000},
    max_age_hours=24,
)
```

**Parameters of note** (verbatim `Args:` text): `query`; `type` (`Search type - "auto" (default, recommended), "instant", "fast", or "deep"`); `category`; `num_results` (`Number of results to return (max 100, default 10)`); `include_domains`/`exclude_domains`; crawl-date and published-date ranges (ISO 8601); `include_text` / `exclude_text` (`List of strings that must be present in webpage text (max 1 string, up to 5 words)`); `context` (`Format results for LLM context - True/False or object with maxCharacters`); `text` (`Include full page text - True/False or object with maxCharacters and includeHtmlTags. Use maxCharacters to control text length instead of relying on default limits`); `highlights` (`Token-efficient page excerpts - True/False or object with maxCharacters and optional query for guiding highlight extraction`); `summary` (`Generate summaries - object with query and optional schema for structured output`); `livecrawl` (never/fallback/always/preferred); `livecrawl_timeout` (`Timeout for live crawling in milliseconds (default 10000)`); `max_age_hours`; `subpages`; `subpage_target`; `extras`.

The distinctive part for research: the model itself chooses how much of each page comes back with the search (`text` with `maxCharacters`, query-guided `highlights`, or a query-guided `summary`), so search and "read the relevant part" happen in one call.

**`exa_get_contents`**: `urls` (required list) plus the same content options (`text`, `highlights`, `summary`, `livecrawl`, `subpages`, `extras`, `context`). Its description says: `This endpoint provides instant results from Exa's cache with automatic live crawling as fallback for uncached pages. It's perfect for extracting content from specific URLs you already know about.`

Both return the raw API JSON as a Python dict string, untruncated.

## 7. Community package: `http_request` (deprecated)

**Description, verbatim** (`http_request.py` lines 90–98):

```
Make HTTP requests to any API with comprehensive authentication including Bearer tokens, Basic auth, JWT, AWS SigV4, Digest auth, and enterprise authentication patterns. Includes session management, metrics, streaming support, cookie handling, redirect control, and optional HTML to markdown conversion.
```

Hand-written JSON schema (lines 99–240), required `method` and `url`. Research-relevant properties: `convert_to_markdown` (`Convert HTML responses to markdown format (default: False).`), `timeout` (`Request timeout in seconds (default: 30). Use a large value for no timeout.`), `allow_redirects`, `max_redirects`. The rest are auth, cookie and session options.

**Returns** several text blocks: `Status Code: 200`, optional `Redirects: ...`, `Headers: {Content-Type, Content-Length, Date, Server, Payment-Required only}`, `Body: <whole body>`, optional `Metrics: ...` (lines 1003–1030). The body is never truncated. HTML→markdown uses plain `markdownify` with ATX headings, with no removal of navigation or scripts.

## 8. Community package: `think` (deprecated)

**Runs:** as **nested agents**, one fresh agent per cycle. Each nested agent inherits all of the parent's tools except `think` itself (so the "thinking" sub-agent can search the web).

**Description, verbatim** (`think.py` lines 304–336 minus `Args:`):

```
Process a thought through multiple recursive thinking cycles for deep analysis.

Each cycle builds on the previous cycle's output, producing depth of analysis that is
difficult to reach in a single pass. Use this for problems that benefit from sustained
reasoning: architecture decisions, tradeoff analysis, ethical implications, or open-ended
ideation. The nested agent can call other tools during its cycles, but never itself.

Returns:
    Dict with "status" ("success" or "error") and "content", a list containing the
    concatenated output of all thinking cycles, or error details on failure.
```

**Parameters** (verbatim from `Args:`):

| Name | Type | Required | Description |
|---|---|---|---|
| `thought` | string | yes | `The thought or idea to process. Can be a question, statement, problem description, or creative prompt.` |
| `cycle_count` | int | yes | `Number of thinking cycles to perform (1-10). More cycles give deeper analysis at higher latency and cost; 3-5 is a good default.` |
| `system_prompt` | string | yes | `System prompt for the thinking agent. Specifies WHO the agent is - its persona, role, and expertise domain. For example, "You are a creative AI researcher specializing in educational technology."` |
| `tools` | list of strings | no | `Tool names to make available to the nested agent. Must exist in the parent agent's tool registry, e.g. ["calculator", "file_read", "retrieve"]. Defaults to inheriting all of the parent agent's tools.` |
| `model_provider` | string | no | `Provider for the thinking cycles. One of "bedrock", "anthropic", "litellm", "llamaapi", "ollama", "openai", "github", or "env" to select the provider from environment variables. Defaults to the parent agent's model.` |
| `model_settings` | object | no | model config |
| `thinking_system_prompt` | string | no | `Optional instructions controlling HOW the agent thinks, as opposed to system_prompt which controls who it is. ...` |

**What happens** (lines 138–162, 337–389): each cycle gets this user prompt (default instructions, verbatim):

```
Direct Tasks:
1. Process this thought deeply and analytically
2. Generate clear, structured insights
3. Consider implications and connections
4. Provide actionable conclusions
5. Use other available tools as needed for analysis

Current Cycle: {cycle}/{total_cycles}

Thought to process:
{thought}

Please provide your analysis directly:
```

After cycle 1, the "thought" becomes `Previous cycle concluded: {cycle_response}\nContinue developing these ideas further.` The tool returns all cycles joined as `Cycle 1/3:\n...\n\nCycle 2/3:\n...`. The deprecation message recommends native extended thinking instead. Note this is *not* a scratchpad "think" tool like Anthropic's; it spends real model calls.

## 9. Community package: `use_agent`

**Runs:** one nested agent with its own system prompt, optionally on another provider.

**Description** (`use_agent.py` lines 80–178, docstring minus `Args:`), first paragraph verbatim:

```
Start a new AI event loop with a specified prompt and optionally different model.

This function creates a new Strands Agent instance with the provided system prompt,
optionally using a different model provider than the parent agent, runs it with the
specified prompt, and returns the response with performance metrics.
```

followed by verbatim sections "How It Works", "Model Selection Process", "Common Use Cases", "Returns", "Environment Variables for Model Switching", "Examples" and "Notes".

**Parameters:** `prompt` (`The prompt to process with the new agent instance.`), `system_prompt` (`Custom system prompt for the agent.`), `tools` (names from the parent's registry; defaults to all), `model_provider`, `model_settings`.

**Returns** three text blocks: `Response: <text>`, `Model: <info>`, `Metrics: <metrics string>`. This is how a Strands agent would hand page reading or a sub-question to a cheaper model.

## 10. Community package: `current_time` (deprecated)

**Description, verbatim** (`current_time.py`, docstring minus `Args:`):

```
Get the current time in ISO 8601 format.

This tool returns the current date and time in ISO 8601 format (e.g., 2023-04-15T14:32:16.123456+00:00)
for the specified timezone. If no timezone is provided, the value from the DEFAULT_TIMEZONE
environment variable is used (defaults to 'UTC' if not set).

Returns:
    str: The current time in ISO 8601 format.

Raises:
    ValueError: If an invalid timezone is provided.

Examples:
    >>> current_time()  # Returns current time in default timezone (from DEFAULT_TIMEZONE or UTC)
    '2023-04-15T14:32:16.123456+00:00'

    >>> current_time(timezone="US/Pacific")  # Returns current time in Pacific timezone
    '2023-04-15T07:32:16.123456-07:00'
```

Parameter `timezone` (optional). The deprecation message says to inject the time with the core SDK's `ContextInjector` plugin instead, whose documented example is `ContextInjector(lambda context: f"<now>{datetime.datetime.now().isoformat()}</now>")` (`vended_plugins/context_injector/plugin.py` line 15). That plugin adds text to the model input before every model call.

## 11. Community package: `stop`

Hand-written spec (`stop.py` lines 39–53): name `stop`, description `Stops the current event loop cycle by setting stop_event_loop flag`, one optional parameter `reason` (`Optional reason for stopping the event loop cycle`). It is the only explicit "I am done" tool in Strands, and it carries no answer payload.

---

## Budget and context mechanisms (not tools, but they shape what the model sees)

- **Sliding window truncation** (`agent/conversation_manager/sliding_window_conversation_manager.py`, lines 19 and 301–360): when the context overflows, old tool results are cut to their first and last 200 characters with `... [truncated: N chars removed] ...` in the middle. This happens after the fact, not per call.
- **GoalLoop plugin** (`vended_plugins/goal/plugin.py`): after the agent answers, a judge (another agent on the host model, or a Python callable) checks the answer against a stated goal. On failure the feedback goes back to the agent as a user message and the loop continues, up to `max_attempts` or a `timeout`. This is a "check the final answer" mechanism outside the tool list.
- No tool tells the model how many calls or how much money it has left.

## What is distinctive

- The default `web_fetch` is **agentic**: the main model must say what it wants from the page, and a separate model call answers from the page. The main model never sees the page text. This saves context but makes exact quoting depend on the analyst's system prompt ("preserve concrete details (names, numbers, quotes, links)").
- The **ContextOffloader** turns any large tool result into a 4,000-character preview plus a reference that can be grepped by regex or read by line range, with line numbers. This is the in-page search design in Strands. It is generic: it is not part of `web_fetch`.
- The community search tools give the model a very wide parameter surface (Tavily has 18 parameters, Exa has 25) and return the vendor's raw JSON as a Python dict string with no truncation.
