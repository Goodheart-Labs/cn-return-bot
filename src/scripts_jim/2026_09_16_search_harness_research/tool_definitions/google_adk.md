# Google ADK (Agent Development Kit): research tool definitions

Sources read: `adk-python` (package `google.adk`, paths below are relative to `adk-python/src/google/adk/`) and `adk-js` (paths relative to `adk-js/core/src/`). Gemini server behaviour comes from the Gemini API docs (ai.google.dev, fetched 2026-09-23) and from the Vercel AI SDK's response schema for Gemini (`ai/packages/google/src/google-language-model.ts:1527-1716`), which mirrors the wire format. Anything taken from those is labelled "from docs".

ADK is Google's agent framework. Its web research story is almost entirely delegated to Gemini's own server-side tools. ADK itself ships only one client-side page reader (`load_web_page`), and no client-side search at all.

## Index

| Tool | Runs where | Research role | Python | JS |
|---|---|---|---|---|
| `google_search` | Gemini's servers (a Gemini "built-in tool") | search + reading + citations, all hidden | `tools/google_search_tool.py` | `tools/google_search_tool.ts` |
| `google_search_agent` (auto wrapper) | nested ADK agent run, which itself uses Gemini's server search | search when other tools are present | `tools/google_search_agent_tool.py` | – |
| `url_context` | Gemini's servers | fetch and read given URLs | `tools/url_context_tool.py` | `tools/url_context_tool.ts` |
| `enterprise_web_search` | Gemini (Vertex) servers | compliance variant of search | `tools/enterprise_search_tool.py` | `tools/enterprise_web_search_tool.ts` |
| `load_web_page` | harness process (plain HTTP GET) | page reading | `tools/load_web_page.py` | `tools/load_web_page.ts` |
| `set_model_response` | harness process | final answer with a schema | `tools/set_model_response_tool.py` | – |
| `finish_task` | harness process | final answer of a task-mode sub-agent | `agents/llm/task/_finish_task_tool.py` | `tools/finish_task_tool.ts` |
| `exit_loop` | harness process | stop a LoopAgent | `tools/exit_loop_tool.py` | `tools/exit_loop_tool.ts` |
| `load_memory` | harness process | search long-term memory | `tools/load_memory_tool.py` | `tools/load_memory_tool.ts` |
| `consolidate_context` | harness process, then a summariser model call | context compaction on demand | – | `tools/consolidate_context_tool.ts` |
| AgentTool (any sub-agent) | nested agent run | delegation | `tools/agent_tool.py` | `tools/agent_tool.ts` |

Briefly listed, not detailed: `vertex_ai_search` / `discovery_engine_search` (search over the developer's own Vertex AI Search data store), `google_maps_grounding`, `load_artifacts`, `preload_memory`, retrieval tools (`files_retrieval`, `llama_index_retrieval`, `vertex_rag_retrieval`), skill tools (`list_skills`, `load_skill`, `search_skills`, `run_skill_script`), `bash_tool`, computer use, MCP, OpenAPI toolsets, `get_user_choice`, `transfer_to_agent`. None of these is a web reader.

There is no in-page search tool, no "page 2 of this document" tool, no think tool, and no budget or time tool anywhere in ADK. The only budget-like mechanism is `RunConfig.max_llm_calls` (default 500), which the model is never told about.

---

## 1. `google_search`

**Where it runs:** on Gemini's servers. ADK does not execute anything. It only appends `types.Tool(google_search=types.GoogleSearch())` to the request (`tools/google_search_tool.py:79-81`). For Gemini 1.x models the JS version sends `googleSearchRetrieval: {}` instead of `googleSearch: {}` (`tools/google_search_tool.ts:43,51`).

**Description, verbatim:** there is none that reaches the model. ADK sets a placeholder and says so in a comment:

```python
    # Name and description are not used because this is a model built-in tool.
    super().__init__(name='google_search', description='google_search')
```

The model-facing description of Gemini's built-in search is not public. The class docstring (developer-facing only) is:

```
A built-in tool that is automatically invoked by Gemini models to retrieve search results from Google Search.

This tool operates internally within the model and does not require or perform
local code execution.
```

**Parameters:** the model fills in nothing visible. Gemini writes its own queries internally. Developer configuration:

| Name | Type | Default | Description (verbatim) |
|---|---|---|---|
| `bypass_multi_tools_limit` | bool | False | "Whether to bypass the multi tools limitation, so that the tool can be used with other tools in the same agent." |
| `model` | str \| None | None | "Optional model name to use for processing the LLM request. If provided, this model will be used instead of the model from the incoming llm_request." |

Non-Gemini models raise `ValueError('Google search tool is not supported for model ...')` (`google_search_tool.py:83-85`).

**What happens when called (from docs):** the Gemini docs describe five steps, quoted: "2. **Prompt Analysis:** The model analyzes the prompt and determines if a Google Search can improve the answer. 3. **Google Search:** If needed, the model automatically generates one or multiple search queries and executes them. 4. **Search Results Processing:** The model processes the search results, synthesizes the information, and formulates a response." The search results themselves never appear in the conversation. The developer gets the final text plus `groundingMetadata`, whose shape (from the AI SDK's schema of the Gemini wire format) is:

```json
{
  "webSearchQueries": ["query the model ran", "..."],
  "searchEntryPoint": { "renderedContent": "<html search-suggestions chip>" },
  "groundingChunks": [ { "web": { "uri": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/...", "title": "example.com" } } ],
  "groundingSupports": [
    { "segment": { "startIndex": 0, "endIndex": 87, "text": "sentence in the answer" },
      "groundingChunkIndices": [0, 2], "confidenceScores": [0.91, 0.64] }
  ],
  "retrievalMetadata": { "webDynamicRetrievalScore": 0.7 }
}
```

So citations are attached by the server: each span of the answer points to indices in `groundingChunks`. The model never quotes a source itself. Billing (from docs): "When you use Grounding with Google Search with Gemini 3, your project is billed for each search query that the model decides to execute." Older models are billed per prompt.

ADK copies `grounding_metadata` onto its `Event` objects and stores it in sessions (`sessions/schemas/v0.py:263,364`), but does not render citations itself.

**Prompt rules:** none. ADK adds no instruction for this tool.

## 2. `google_search_agent` (automatic wrapper)

**Why it exists:** the Gemini API does not allow a built-in tool such as `google_search` in the same request as ordinary function tools. ADK works around this. If an agent has several tools and `google_search` was created with `bypass_multi_tools_limit=True`, ADK silently replaces it with an AgentTool that runs a separate one-tool agent (`agents/llm_agent.py:155-164`):

```python
  # Wrap google_search tool with AgentTool if there are multiple tools because
  # the built-in tools cannot be used together with other tools.
  # TODO: Remove once the workaround is no longer needed.
  if multiple_tools and isinstance(tool_union, GoogleSearchTool):
    ...
    if search_tool.bypass_multi_tools_limit:
      return [GoogleSearchAgentTool(create_google_search_agent(model))]
```

**Where it runs:** a nested ADK Runner with its own in-memory session, calling Gemini with only `google_search` enabled.

**Description, verbatim** (the AgentTool uses the sub-agent's description; `tools/google_search_agent_tool.py:30-32`):

```
An agent for performing Google search using the `google_search` tool
```

The sub-agent's own instruction (`google_search_agent_tool.py:33-37`):

```
        You are a specialized Google search agent.

        When given a search query, use the `google_search` tool to find the related information.
```

**Parameters (model fills in):** AgentTool declares one parameter (`tools/agent_tool.py:176-194`):

```json
{"type": "object", "properties": {"request": {"type": "string"}}, "required": ["request"]}
```

**What it does:** runs the sub-agent to completion and returns the text of its last event, with thought parts dropped and parts joined by newlines (`agent_tool.py:342-352`). So the outer model receives a Gemini-written prose summary, never raw result lists. Because `propagate_grounding_metadata=True`, the last event's `grounding_metadata` is stored in state `temp:_adk_grounding_metadata` (`agent_tool.py:354-357`), and the finalizer attaches it to the outer agent's next response (`flows/llm_flows/core/_finalizer.py:187-206`). The citations therefore point at spans of the inner agent's summary, not the outer agent's final answer. The nested run inherits the caller's `RunConfig`, including `max_llm_calls` (`agent_tool.py:291-313`).

## 3. `url_context`

**Where it runs:** Gemini's servers. ADK appends `types.Tool(url_context=types.UrlContext())` (`tools/url_context_tool.py:58-60`). JS requires Gemini 2 or newer (`tools/url_context_tool.ts:39-42`).

**Description:** placeholder only ("Name and description are not used because this is a model built-in tool.", `url_context_tool.py:40-41`). Model-facing text is not public. Class docstring: "A built-in tool that is automatically invoked by Gemini 2 models to retrieve content from the URLs and use that content to inform and shape its response."

**Parameters:** none visible. The URLs come from the prompt text; Gemini decides which to read.

**What happens (from docs):** "The URL Context tool uses a two-step retrieval process to balance speed, cost, and access to fresh data." It "first attempts to fetch the content from an internal index cache" and "automatically falls back to do a live fetch". Limits: "up to 20 URLs per request" and "The maximum size for content retrieved from a single URL is 34MB". Supported types: text formats (HTML, JSON, plain text, XML, CSS, JS, CSV, RTF), PNG/JPEG/BMP/WebP images and PDF. Paywalled pages, logins, YouTube, Google Workspace files and audio/video are not supported. Retrieved content counts as input tokens. The response carries `urlContextMetadata.urlMetadata[] = { retrievedUrl, urlRetrievalStatus }` (AI SDK schema, `google-language-model.ts:1707-1716`), so the developer can see which URLs failed.

**Prompt rules:** none.

## 4. `enterprise_web_search`

Gemini built-in on Vertex, same mechanics as `google_search` ("A Gemini built-in tool using web grounding for Enterprise compliance.", `tools/enterprise_search_tool.py:32`). Placeholder description, no parameters, no ADK prompt rules.

## 5. `load_web_page`

**Where it runs:** the harness process, as a plain `requests.get` (Python) or `fetch` (JS). No browser, no JavaScript rendering.

**Description, verbatim.** Python builds the description from the function's docstring (`tools/function_tool.py:117-121`), so the model sees:

```
Fetches the content in the url and returns the text in it.

Args:
    url (str): The url to browse.

Returns:
    str: The text content of the url.
```

JS (`tools/load_web_page.ts:126-134`):

```
Fetches the content at the given URL and returns the readable text extracted from the page.
```

**Parameters (model fills in):**

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Python: from the docstring, "The url to browse." JS: "The URL to fetch and extract text from." |

Developer configuration: JS `timeoutMs` (default 30,000). Nothing else.

**What it does** (`tools/load_web_page.py:314-346`):
1. Rejects non-http(s) schemes, `localhost`, and any hostname that resolves to a non-global address (SSRF protection, lines 120-311). Redirects are never followed (`allow_redirects=False`), so a page that answers 301 counts as a failure.
2. GET with a 30-second timeout (`_DEFAULT_TIMEOUT_SECONDS = 30`, line 34).
3. If the status is not 200, returns `Failed to fetch url: <url>`.
4. Parses with BeautifulSoup/lxml, takes `soup.get_text(separator='\n', strip=True)`.
5. Drops every line with three words or fewer: `'\n'.join(line for line in text.splitlines() if len(line.split()) > 3)`.

There is **no length cap**: the whole page text comes back however long it is. JS does the same with regex tag stripping, removing `<script>`, `<style>` and comments first (`load_web_page.ts:75-86`). No markdown, no links, no headings kept, no pagination, no in-page search.

Example result: plain newline-separated sentences, e.g.

```
The Federal Reserve held its benchmark rate steady on Wednesday, citing inflation.
Officials projected two cuts later this year, down from three in March.
...
```

Every error (bad scheme, blocked host, timeout, non-200) comes back as the same string `Failed to fetch url: https://...`, so the model cannot tell a 404 from a timeout.

**Prompt rules:** none.

## 6. `set_model_response` (final answer with schema)

**Where it runs:** harness process. ADK adds it automatically when an agent has both `output_schema` and tools and the model cannot do both natively (`flows/llm_flows/prompt/_schema.py:44-56`).

**Description, verbatim** (`tools/set_model_response_tool.py:150-153`, the docstring becomes the description):

```
Set your final response using the required output schema.

      Use this tool to provide your final structured answer instead
      of outputting text directly.
```

(The description is `func.__doc__.strip()`, so the inner indentation is kept exactly as shown.)

**Parameters (model fills in):** the fields of the developer's Pydantic `output_schema`, with their `Field(description=...)` texts carried over and optional fields kept optional (`set_model_response_tool.py:157-213`, `222-259`). For a list schema there is one `items` parameter; for other schemas one `response` parameter.

**What it does:** validates the arguments with Pydantic. On failure it returns, verbatim:

```
{'error': 'Validation Error found:\n<pydantic error>\nRecall the set_model_response function correctly, fix the errors, and call it again with all required fields using the correct types.'}
```

On success it stores the result in `tool_context.actions.set_model_response` and the flow turns it into the agent's final response event (`_schema.py:73-120`).

**Prompt rule injected, verbatim** (`flows/llm_flows/prompt/_schema.py:58-64`):

```
IMPORTANT: You have access to other tools, but you must provide your final response using the set_model_response tool with the required structured format. After using any other tools needed to complete the task, always call set_model_response with your final answer in the specified schema format.
```

## 7. `finish_task`

**Where it runs:** harness process, for an LlmAgent in "task" mode (a delegated sub-agent).

**Description, verbatim** (`agents/llm/task/_finish_task_tool.py:102-107`, same in `tools/finish_task_tool.ts:61-66`):

```
Signal that this agent has completed its delegated task. Call this when you have finished your delegated task.
```

plus, when an output schema is set, ` Pass the required output data in the parameters.`

**Parameters:** the agent's output schema, or by default:

```json
{"type": "OBJECT", "properties": {"result": {"type": "STRING", "description": "A brief summary of what the agent accomplished."}}, "required": ["result"]}
```

Non-object schemas are wrapped under a `result` key.

**What it does:** checks required keys. Missing keys return: "Invoking `finish_task()` failed due to missing required parameters: <keys>. You could retry calling this tool, but it is IMPORTANT for you to provide all the mandatory parameters with correct types." Otherwise it returns `Task completed.` and the arguments become the node's output (`finish_task_tool.ts:109-122`).

**Prompt rule injected, verbatim** (Python `_finish_task_tool.py:161-166`):

```
Do NOT call `finish_task` prematurely. Use your available tools to
fully complete every aspect of the delegated task first. If the
task is unclear, ask the user for clarification before proceeding.
Once the task is fully complete, call `finish_task` by itself with
no accompanying text output.
```

## 8. `exit_loop`

**Where it runs:** harness process. Used inside a `LoopAgent` (for example a refine-until-good loop).

**Description, verbatim** (`tools/exit_loop_tool.py:21-23`; JS `exit_loop_tool.ts:25-26`):

```
Exits the loop.

Call this function only when you are instructed to do so.
```

**Parameters:** none.

**What it does:** sets `actions.escalate = True` and `actions.skip_summarization = True`, which makes the enclosing LoopAgent stop iterating. Returns nothing (JS returns `''`). The loop's own iteration cap is `max_iterations` on the LoopAgent, which the model is not told.

## 9. `load_memory`

**Where it runs:** harness process, against the configured MemoryService.

**Description, verbatim** (docstring, `tools/load_memory_tool.py:41-47`):

```
Loads the memory for the current user.

Args:
  query: The query to load the memory for.

Returns:
  A list of memory results.
```

**Parameters:** `{"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}`.

**What it does:** calls `search_memory(query)` and returns `{"memories": [MemoryEntry...]}`, where each entry has `content`, `author`, `timestamp`, `id`, `custom_metadata`. The in-memory backend is keyword overlap over past session events (`memory/in_memory_memory_service.py:136-180`); the Vertex backends are semantic.

**Prompt rule injected, verbatim** (`load_memory_tool.py:101-104`):

```
You have memory. You can use it to answer questions. If any questions need
you to look up the memory, you should call load_memory function with a query.
```

## 10. `consolidate_context` (adk-js only)

**Where it runs:** the tool only sets a flag in the harness. On the next turn the `AgentControlledContextCompactor` calls a summariser model over all events before the tool call (`context/agent_controlled_context_compactor.ts:27-94`).

**Description, verbatim** (`tools/consolidate_context_tool.ts:22-25`):

```
Requests context consolidation (compaction) to manage history size. Use this when a subtask is complete and you want to summarize progress and clear detailed history.
```

**Parameters (model fills in):**

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `detail` | string | no | "Optional description of what has been accomplished so far. This detail will be used to guide the summarization of the history." |

**What it does:** sets state `temp:consolidate_context = true` and optionally `temp:consolidate_context_detail`, and returns `{status: 'success', message: 'Context consolidation requested.'}`. The compactor then summarises everything before the call, prefixing the summariser's input with `CRITICAL INSTRUCTION FOR SUMMARY: Please summarize the history. Focus especially on: ${detail}` (line 71). If summarising fails, the flags are cleared and nothing is compacted. This is the one place in ADK where the model itself controls its context budget.

---

## What stands out for web research

- ADK has no client-side search. Search is only ever Gemini's hidden server search, and its raw results never enter the conversation. The model cannot see ten snippets and choose which page to open.
- Citations are produced by the server as `groundingSupports` spans, not by the model quoting text.
- When search is combined with other tools, ADK hides it behind a nested agent that returns a prose summary. The outer model gets a second-hand answer.
- `load_web_page` is the simplest page reader in any framework studied: no truncation at all, no markdown, drop lines of three words or fewer, no redirects followed, and one generic error string for every failure.
- The final-answer tools (`set_model_response`, `finish_task`) are the only tools that come with injected prompt rules telling the model when to call them.
