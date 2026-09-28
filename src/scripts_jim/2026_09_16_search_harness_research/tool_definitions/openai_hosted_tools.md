# OpenAI hosted tools (Responses API, as wrapped by `openai-agents-python`)

Sources read:
- `sdks/openai-agents-python/src/agents/tool.py` (hosted tool dataclasses)
- `sdks/openai-agents-python/src/agents/models/openai_responses.py` (how the dataclasses become request JSON)
- `sdks/openai-python/src/openai/types/responses/` (the generated API types: `web_search_tool.py`, `web_search_preview_tool.py`, `response_function_web_search.py`, `response_output_text.py`, `response_includable.py`)
- OpenAI web search guide, fetched 2026-09-23 from https://developers.openai.com/api/docs/guides/tools-web-search (labelled "from docs" below)

The key fact up front: OpenAI's hosted `web_search` is a **black box to the developer**. The developer only sends `{"type": "web_search", ...config}`. The model-facing tool description, the parameter schema the model fills in, the result text the model reads, and the page-reading tool are all inside OpenAI's servers and are not published. What the API does expose is a log of what the model did: each `web_search_call` output item records one *action*, which is `search`, `open_page` or `find_in_page`. That tells us the hidden tool has three operations (search, open a page, find text in an open page), which is the same design as the smolagents text browser and the older WebGPT/"browser" tool.

## Index

| Tool (API `type`) | SDK class | Runs where | Model fills in | Web research relevance |
|---|---|---|---|---|
| `web_search` / `web_search_2025_08_26` | `WebSearchTool` | OpenAI servers | hidden (actions: search / open_page / find_in_page) | the main search + read tool |
| `web_search_preview` / `web_search_preview_2025_03_11` | none (raw API only) | OpenAI servers | hidden | older version of the above |
| `file_search` | `FileSearchTool` | OpenAI servers | hidden (query over a vector store) | retrieval over uploaded documents |
| `code_interpreter` | `CodeInterpreterTool` | OpenAI sandbox container | code | brief |
| `mcp` | `HostedMCPTool` | OpenAI servers call a remote MCP server | MCP tool arguments | brief |
| `tool_search` | `ToolSearchTool` | OpenAI servers (or client) | search over deferred tools | brief |
| `programmatic_tool_calling` | `ProgrammaticToolCallingTool` | OpenAI servers | JavaScript | brief |
| `image_generation`, `computer`, `shell`, `local_shell`, `apply_patch` | various | mixed | — | not relevant |

---

## 1. `web_search` (`WebSearchTool`)

**Where it runs.** On OpenAI's servers, inside the same model call. The agents SDK never executes anything; it only serialises the configuration. The model may call it several times within one response (with reasoning models, as part of its chain of thought).

### Description (as the model sees it)

Not public. OpenAI does not publish the model-facing description or input schema of the hosted web search tool. The only descriptions available are the developer-facing docstrings:

```text
Search the Internet for sources related to the prompt.

Learn more about the
[web search tool](https://developers.openai.com/api/docs/guides/tools-web-search).
```
(`openai-python/src/openai/types/responses/web_search_tool.py`, class `WebSearchTool` docstring)

```text
A hosted tool that lets the LLM search the web. Currently only supported with OpenAI models,
using the Responses API.
```
(`openai-agents-python/src/agents/tool.py:831`, class `WebSearchTool` docstring)

### Parameters

The model's own arguments are hidden. Everything below is **developer configuration**, set once when the tool is declared.

API type (`openai-python/.../web_search_tool.py`), docstrings verbatim:

| Field | Type | Default | Description (verbatim) |
|---|---|---|---|
| `type` | `"web_search" \| "web_search_2025_08_26"` | required | "The type of the web search tool. One of `web_search` or `web_search_2025_08_26`." |
| `external_web_access` | bool, optional | true | "Allow live internet access for web search. Defaults to true when omitted. When false, the web search tool runs in offline/cache-only mode and will not fetch new external content." |
| `filters.allowed_domains` | list[str], optional | all | "Allowed domains for the search. If not provided, all domains are allowed. Subdomains of the provided domains are allowed as well. Example: `[\"pubmed.ncbi.nlm.nih.gov\"]`" |
| `search_context_size` | `"low" \| "medium" \| "high"`, optional | medium | "High level guidance for the amount of context window space to use for the search. One of `low`, `medium`, or `high`. `medium` is the default." |
| `user_location` | object, optional | — | "The approximate location of the user." Sub-fields: `city` ("Free text input for the city of the user, e.g. `San Francisco`."), `country` ("The two-letter [ISO country code](https://en.wikipedia.org/wiki/ISO_3166-1) of the user, e.g. `US`."), `region` ("Free text input for the region of the user, e.g. `California`."), `timezone` ("The [IANA timezone](https://timeapi.io/documentation/iana-timezones) of the user, e.g. `America/Los_Angeles`."), `type` ("The type of location approximation. Always `approximate`.") |

Extra fields the agents SDK dataclass adds (`tool.py:831-895`), docstrings verbatim:

| Field | Type | Default | Docstring |
|---|---|---|---|
| `search_context_size` | Literal low/medium/high | `"medium"` | "The amount of context to use for the search." |
| `external_web_access` | bool \| None | None | "Whether the web search tool may fetch live internet content. When omitted, the API default is used. Set to `False` to request cached or indexed-only behavior where supported." |
| `search_content_types` | list["text" \| "image"] \| None | None | "The kinds of results the search may return. When omitted, the API default (text only) is used. Include `\"image\"` to receive image results. Use `image_settings` to customize those results." |
| `image_settings` | `{max_results: int, caption: bool}` | None | "Settings for image results when `search_content_types` includes `\"image\"`." (`max_results`: "The number of image results to return."; `caption`: "Whether to include a short caption with each image when one is available.") |

From docs: "With the `filters` parameter you can configure up to 100 `allowed_domains` or up to 100 `blocked_domains`." Note that the generated Python type in `openai-python` only has `allowed_domains`; `blocked_domains` appears in the docs and in the Vercel AI SDK schema but not in this SDK version.

### What it does when called

**The SDK side** (`openai-agents-python/src/agents/models/openai_responses.py:2183-2203`): the dataclass becomes

```python
{
    "type": "web_search",
    "filters": tool.filters.model_dump() if tool.filters is not None else None,
    "user_location": tool.user_location,
    "search_context_size": tool.search_context_size,
    # plus external_web_access / search_content_types / image_settings when set
}
```

It also adds `include=["web_search_call.results"]` to the request, but **only** when `search_content_types` contains `"image"`. It never requests `web_search_call.action.sources` by default, so an agents-SDK user does not get the full list of consulted URLs unless they add that `include` themselves. (The Vercel AI SDK does add it by default; see `vercel_provider_tools.md`.)

**The server side (from docs, not visible in code).** OpenAI describes three modes:

- "Non-reasoning web search: The non‑reasoning model sends the user's query to the web search tool, which returns the response based on top results."
- "Agentic search with reasoning models: The model actively manages the search process. It can perform web searches as part of its chain of thought, analyze results, and decide whether to keep searching."
- "Deep research: A specialized, agent-driven method for in-depth, extended investigations by reasoning models. The model conducts web searches as part of its chain of thought, often tapping into hundreds of sources."

Limit from docs: search context stays capped at "128k, even when the model context window is larger."

**What comes back to the developer.** The response `output` array contains one `web_search_call` item per action, followed by the assistant `message`. The action types are defined in `openai-python/src/openai/types/responses/response_function_web_search.py`, docstrings verbatim:

| Action | Fields | Docstring |
|---|---|---|
| `search` | `query` (str, optional), `queries` (list[str], optional), `sources` (list of `{type: "url", url}`, optional) | "Action type \"search\" - Performs a web search query." `sources`: "The sources used in the search." |
| `open_page` | `url` (str, optional) | "Action type \"open_page\" - Opens a specific URL from search results." `url`: "The URL opened by the model." |
| `find_in_page` | `url` (str), `pattern` (str) | "Action type \"find_in_page\": Searches for a pattern within a loaded page." `pattern`: "The pattern or text to search for within the page." `url`: "The URL of the page searched for the pattern." |

The item itself: `id`, `action`, `status` (`"in_progress" | "searching" | "completed" | "failed" | "incomplete"`), `type: "web_search_call"`. The item's `action` docstring: "An object describing the specific action taken in this web search call. Includes details on how the model used the web (search, open_page, find_in_page)."

So the model's in-page search is a separate step: it opens a page and then asks for a pattern inside it, rather than receiving the whole page. The text returned to the model by `open_page` and `find_in_page` is not exposed to the developer at all.

`include` values relevant here (`response_includable.py`): `"web_search_call.results"` (raw results; used for image results with `image_url`, `source_website_url`, `thumbnail_url`, `caption`, per `openai-agents-python/docs/tools.md`) and `"web_search_call.action.sources"`. From docs, `sources` is "the complete list of URLs the model consulted when forming its response".

**Citations.** The final message text carries `url_citation` annotations (`response_output_text.py:37`, `AnnotationURLCitation`): `start_index` ("The index of the first character of the URL citation in the message."), `end_index` ("The index of the last character of the URL citation in the message."), `title` ("The title of the web resource."), `url` ("The URL of the web resource."), `type: "url_citation"`. There is **no quoted passage** in the citation; it only links a span of the answer to a URL. Contrast Anthropic's `cited_text`.

Example output shape (constructed from the types above, not a captured response):

```json
[
  {"type": "web_search_call", "id": "ws_1", "status": "completed",
   "action": {"type": "search", "queries": ["Kherson dam collapse date"],
              "sources": [{"type": "url", "url": "https://en.wikipedia.org/wiki/..."}]}},
  {"type": "web_search_call", "id": "ws_2", "status": "completed",
   "action": {"type": "open_page", "url": "https://en.wikipedia.org/wiki/..."}},
  {"type": "web_search_call", "id": "ws_3", "status": "completed",
   "action": {"type": "find_in_page", "url": "https://en.wikipedia.org/wiki/...", "pattern": "6 June 2023"}},
  {"type": "message", "role": "assistant", "content": [
    {"type": "output_text", "text": "The dam collapsed on 6 June 2023 [...]",
     "annotations": [{"type": "url_citation", "start_index": 0, "end_index": 40,
                      "title": "Destruction of the Kakhovka Dam", "url": "https://en.wikipedia.org/wiki/..."}]}]}
]
```

### Prompt rules

The agents SDK has no default prompt text about web search. The only guidance is in examples. `examples/research_bot/agents/search_agent.py`:

```text
You are a research assistant. Given a search term, you search the web for that term and produce a concise summary of the results. The summary must be 2-3 paragraphs and less than 300 words. Capture the main points. Write succinctly, no need to have complete sentences or good grammar. This will be consumed by someone synthesizing a report, so its vital you capture the essence and ignore any fluff. Do not include any additional commentary other than the summary itself.
```

`examples/research_bot/agents/planner_agent.py` (a separate agent with structured output `WebSearchPlan{searches: [{reason, query}]}`, field docstrings "Your reasoning for why this search is important to the query." and "The search term to use for the web search."):

```text
You are a helpful research assistant. Given a query, come up with a set of web searches to perform to best answer the query. Output between 5 and 20 terms to query for.
```

Docs rule for developers (not the model): "When displaying web results or information contained in web results to end users, inline citations must be made clearly visible and clickable."

---

## 2. `web_search_preview`

**Where it runs:** OpenAI servers. Older version of `web_search`; no class in the agents SDK. Type `openai-python/.../web_search_preview_tool.py`, docstring:

```text
This tool searches the web for relevant results to use in a response.
```

Config: `type` (`web_search_preview` or `web_search_preview_2025_03_11`), `search_content_types` (text / image), `search_context_size` (same docstring as above), `user_location` ("The user's location."). No domain filters and no `external_web_access`. Output items are the same `web_search_call` type.

---

## 3. `file_search` (`FileSearchTool`)

**Where it runs:** OpenAI servers, over the developer's vector stores. Model-facing description not public. SDK docstring (`tool.py:793`): "A hosted tool that lets the LLM search through a vector store. Currently only supported with OpenAI models, using the Responses API."

Developer config: `vector_store_ids` ("The IDs of the vector stores to search."), `max_num_results` ("The maximum number of results to return, from 1 through 50. None or zero uses the provider default."), `include_search_results` ("Whether to include the search results in the output produced by the LLM." — adds `include=["file_search_call.results"]`), `ranking_options`, `filters` ("A filter to apply based on file attributes."). The SDK raises `UserError` if `max_num_results` is outside 0..50 (`openai_responses.py:2209-2219`).

Relevance to us: this is how OpenAI would have the model search a long document the developer uploaded ahead of time, rather than reading it in pieces.

---

## 4. Brief: other hosted tools

- `CodeInterpreterTool` (`tool.py:1162`): "A tool that allows the LLM to execute code in a sandboxed environment." Config is the raw `CodeInterpreter` dict (container etc.).
- `HostedMCPTool` (`tool.py:1131`): "A tool that allows the LLM to use a remote MCP server. The LLM will automatically list and call tools, without requiring a round trip back to your code." Optional `on_approval_request` callback.
- `ToolSearchTool` (`tool.py:1614`): "A hosted Responses API tool that lets the model search deferred tools by namespace." Optional `description`, `execution` ("server" or "client"), `parameters`.
- `ProgrammaticToolCallingTool`: "A hosted Responses tool that lets generated JavaScript orchestrate other tools."

## Final answer and budget awareness

- There is **no final-answer tool**. An agent's final output is either the plain message or a structured `output_type` (Pydantic model sent as the response JSON schema). `tool_use_behavior` / `StopAtTools` (`agent.py:143, 373`) let the developer stop the loop when a named function tool is called, which is how one would build a "submit answer" tool.
- Budget: `DEFAULT_MAX_TURNS = 10` (`run_config.py:45`) stops the loop with `MaxTurnsExceeded`, but nothing about it is shown to the model. The hosted web search has no developer-visible cap on calls per response (Anthropic's `max_uses` has no OpenAI equivalent); `search_context_size` is the only size knob.
