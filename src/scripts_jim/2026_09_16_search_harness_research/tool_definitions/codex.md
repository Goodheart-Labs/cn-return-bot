# OpenAI Codex CLI: tool definitions

Source: the `codex-rs` workspace under `scratchpad/sdks/codex/codex-rs` (Rust). All paths below are relative to that folder. Line numbers refer to the checkout on disk on 2026-09-23.

## How the tool list is put together

The tool list is assembled per turn in `core/src/tools/spec_plan.rs` (`build_tool_router`, line ~130). Three things decide what the model actually sees.

1. **Feature flags and the model catalog.** `models-manager/models.json` describes each model (`gpt-6-astra`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4`, and others). Fields such as `shell_type`, `apply_patch_tool_type`, `web_search_tool_type`, `supports_search_tool`, `experimental_supported_tools`, `tool_mode` and `use_responses_lite` switch tools on or off.
2. **Direct mode versus code mode.** In direct mode every tool is an ordinary function tool. In **code mode** (a Codex term) the model gets one freeform tool called `exec` that runs JavaScript in a V8 isolate, and every other tool becomes an async function on a global `tools` object inside that JavaScript (for example `await tools.exec_command({...})`, `await tools.web__run({...})`). In the catalog on disk, every model except `gpt-5.5` and `gpt-5.4` has `"tool_mode": "code_mode_only"`, so for the newest models the model's entire tool surface is `exec` plus `wait`, and the tool descriptions below are rendered inside the `exec` description as TypeScript declarations (see the `exec` section).
3. **Two different web search tools.** If the provider supports it and the model uses the "Responses Lite" wire format (or the `StandaloneWebSearch` feature is on), Codex registers the client-executed `web.run` tool from `ext/web-search`. Otherwise it sends OpenAI's hosted `web_search` tool type, which OpenAI's servers run. Only one of the two is ever present (`hosted_model_tool_specs`, `spec_plan.rs` line ~620). Every catalog model with `use_responses_lite: true` therefore gets `web.run`.

There is **no separate "fetch URL" tool** and **no "final answer" tool** in Codex. Page opening, clicking, find-in-page and PDF screenshots are all sub-commands of `web.run`. The turn ends when the model writes a message without a tool call.

Tool outputs in general are truncated to the model's `truncation_policy`, which is `{"mode": "tokens", "limit": 10000}` for every model in the catalog, plus a 20% "serialization allowance" (`utils/output-truncation/src/lib.rs` line 16: `policy * 1.2`). Truncation keeps the head and the tail and cuts the middle, inserting a marker like `…2 tokens truncated…` (`utils/string/src/truncate/tests.rs` line 100). This happens when the output is written into history (`core/src/context_manager/history.rs` line ~431), so it applies to `web.run` output too.

## Index

| Tool (model-visible name) | One-line purpose | Where it runs |
|---|---|---|
| `web.run` (namespace `web`, function `run`) | Search, image search, open page, click link, find in page, PDF screenshot, finance, weather, sports, time, all in one call | Codex process forwards the call to OpenAI's `alpha/search` HTTP endpoint; the actual search and page reading happen on OpenAI's servers |
| `web_search` (hosted) | OpenAI's hosted web search tool | Entirely on OpenAI's Responses API servers |
| `exec` (code mode) | Run JavaScript that calls the other tools | V8 isolate inside the Codex process |
| `wait` (code mode) | Resume a still-running `exec` cell | Codex process |
| `exec_command` | Run a shell command in a PTY | Codex process, sandboxed shell |
| `write_stdin` | Write to or poll a running `exec_command` session | Codex process |
| `apply_patch` | Edit files with a patch grammar (freeform tool) | Codex process |
| `update_plan` | Record a step list with statuses | Codex process (only emits a UI event) |
| `view_image` | Load a local image file into context | Codex process |
| `tool_search` | BM25 search over deferred tools, loading them for the next call | Codex process |
| `clock.curr_time` (feature-flagged) | Current UTC time | Codex process |
| `clock.sleep` (feature-flagged) | Pause for a given duration | Codex process |
| `get_context_remaining` (feature `TokenBudget`) | Tokens left in the context window | Codex process |
| `new_context` (feature `TokenBudget`) | Start a fresh context window | Codex process |
| `request_user_input` | Ask the user 1 to 3 multiple-choice questions and wait | Codex process plus UI |
| `request_user_input_async` | Ask the user questions without blocking the turn | Codex process plus UI |
| `send_message_to_user_async` | Send the user an urgent message without ending the turn | Codex process plus UI |
| `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent` (multi-agent v1, namespace `multi_agent_v1`) | Sub-agents | Child Codex threads in the same process |
| `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents` (multi-agent v2) | Sub-agents with task paths and mailboxes | Child Codex threads in the same process |
| `request_permissions`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`, `wait_for_environment`, `list_available_plugins_to_install`, `request_plugin_install` | Permissions, MCP resources, remote environments, plugins | Codex process |

---

## 1. `web.run` (standalone web search)

**Where it runs.** The model calls a function tool `run` in the namespace `web`. The Codex process (`ext/web-search/src/tool.rs`) does no searching itself. It posts the model's commands, plus a short tail of the conversation, to OpenAI's search endpoint `alpha/search` (`codex-api/src/endpoint/search.rs` line 31; the tests show the full paths `/api/codex/alpha/search` for ChatGPT login and `/v1/alpha/search` for API keys). The server returns a single text string, and that string is what the model sees. Everything that decides what a search result or an opened page looks like happens on OpenAI's server and is not in this repository.

In code mode the same tool is called from JavaScript as `await tools.web__run({...})` (confirmed by `core/tests/suite/code_mode.rs` line 517).

**Description, verbatim** (`ext/web-search/web_run_description.md`, included with `include_str!` at `ext/web-search/src/tool.rs` line 78). The namespace `web` itself gets the default description `Tools in the web namespace.` (`tools/src/responses_api.rs` line 64).

```text
Tool for accessing the internet.


---

## Examples of different commands available in this tool

Examples of different commands available in this tool:
* `search_query`: {"search_query": [{"q": "What is the capital of France?"}, {"q": "What is the capital of belgium?"}]}. Searches the internet for a given query (and optionally with a domain or recency filter)
* `image_query`: {"image_query":[{"q": "waterfalls"}]}.
* `open`: {"open": [{"ref_id": "turn0search0"}, {"ref_id": "https://www.openai.com", "lineno": 120}]}
* `click`: {"click": [{"ref_id": "turn0fetch3", "id": 17}]}
* `find`: {"find": [{"ref_id": "turn0fetch3", "pattern": "Annie Case"}]}
* `screenshot`: {"screenshot": [{"ref_id": "turn1view0", "pageno": 0}, {"ref_id": "turn1view0", "pageno": 3}]}
* `finance`: {"finance":[{"ticker":"AMD","type":"equity","market":"USA"}]}, {"finance":[{"ticker":"BTC","type":"crypto","market":""}]}
* `weather`: {"weather":[{"location":"San Francisco, CA"}]}
* `sports`: {"sports":[{"fn":"standings","league":"nfl"}, {"fn":"schedule","league":"nba","team":"GSW","date_from":"2025-02-24"}]}
* `time`: {"time":[{"utc_offset":"+03:00"}]}

---

## Usage hints
To use this tool efficiently:
* Use multiple commands and queries in one call to get more results faster; e.g. {"search_query": [{"q": "bitcoin news"}], "finance":[{"ticker":"BTC","type":"crypto","market":""}], "find": [{"ref_id": "turn0search0", "pattern": "Annie Case"}, {"ref_id": "turn0search1", "pattern": "John Smith"}]}
* Use "response_length" to control the number of results returned by this tool, omit it if you intend to pass "short" in
* Only write required parameters; do not write empty lists or nulls where they could be omitted.
* `search_query` must have length at most 4 in each call. If it has length > 3, response_length must be medium or long
* If you find yourself in a situation where you accidentally call the `web.run` tool, it's best just to send an empty query: {"search_query": [{"q": ""}]}.

---

## Decision boundary

If the user makes an explicit request to search the internet, find latest information, look up, etc (or to not do so), you must obey their request.
When you make an assumption, always consider whether it is temporally stable; i.e. whether there's even a small (>10%) chance it has changed. If it is unstable, you must verify with browsing the internet for verification.

<situations_where_you_must_browse_the_internet>
Below is a list of scenarios where browsing the internet MUST be used. PAY CLOSE ATTENTION: you MUST browse the internet in these cases. If you're unsure or on the fence, you MUST bias towards browsing the internet.
- The information could have changed recently: for example news; prices; laws; schedules; product specs; sports scores; economic indicators; political/public/company figures (e.g. the question relates to 'the president of country A' or 'the CEO of company B', which might change over time); rules; regulations; standards; software libraries that could be updated; exchange rates; recommendations (i.e., recommendations about various topics or things might be informed by what currently exists / is popular / is safe / is unsafe / is in the zeitgeist / etc.); and many many many more categories -- again, if you're on the fence, you MUST browse the internet!
  - For news queries, prioritize more recent events, ensuring you compare publish dates and the date that the event happened.
- The user is seeking recommendations that could lead them to spend substantial time or money -- researching products, restaurants, travel plans, etc.
- The user wants (or would benefit from) direct quotes, links, or precise source attribution.
- A specific page, paper, dataset, PDF, or site is referenced and you haven't been given its contents.
- You're unsure about a fact, the topic is niche or emerging, or you suspect there's at least a 10% chance you will incorrectly recall it
- High-stakes accuracy matters (medical, legal, financial guidance). For these you generally should search by default because this information is highly temporally unstable
- The user explicitly says to search, browse, verify, or look it up.
</situations_where_you_must_browse_the_internet>

---

## Citations

Results from `web.run` include internal reference IDs such as `turn2search5`. Use
those reference IDs only in calls to `web.run`; do not expose them in the final
response.

Cite sources in the final response using Markdown links:

- Cite a single source as `[descriptive source title](https://example.com/page)`.
- Cite multiple sources with separate Markdown links, for example
  `[first source](https://example.com/one), [second source](https://example.com/two)`.
- Link directly to the page that supports the claim. Do not link to search result
  pages or use bare URLs.

Formatting of citations:

- Place each citation as near as possible to the claim it supports, normally at
  the end of the sentence or paragraph and after punctuation.
- Do not place citations inside code fences.
- Do not put citations on a line by themselves or collect all citations at the
  end of the response.

If you browse the internet, cite statements supported by web sources. Each cited
source must directly support the associated claim. Prefer primary and
authoritative sources, and use sources from different domains when the response
benefits from multiple perspectives.

---

## Special cases
If these conflict with any other instructions, these should take precedence.

<special_cases>
- When the user asks for information about how to use OpenAI products, (ChatGPT, the OpenAI API, etc.), you should check the code in local env and only browse as fallback, when you browse restrict your sources to official OpenAI websites using the domains filter, unless otherwise requested.
- When using search to answer technical questions, you must only rely on primary sources (research papers, official documentation, etc.)
- Clearly indicate when you are making an inference from sources.
</special_cases>

---

## Word limits
Responses may not excessively quote or draw on a specific source. There are several limits here:
- **Limit on verbatim quotes:**
  - You may not quote more than 25 words verbatim from any single non-lyrical source, unless the source is reddit.
  - For song lyrics, verbatim quotes must be limited to at most 10 words.
  - Long quotes from reddit are allowed, as long as you indicate that those are direct quotes via a markdown blockquote starting with ">", copy verbatim, and link the source.
- **Word limits:**
  - Each webpage source in the sources has a word limit label formatted like "[wordlim N]", in which N is the maximum number of words in the whole response that are attributed to that source. If omitted, the word limit is 200 words.
  - Non-contiguous words derived from a given source must be counted to the word limit.
  - The summarization limit N is a maximum for each source.
  - When using multiple sources, their summarization limits add together. However, each article used must be relevant to the response.
- **Copyright compliance:**
  - You must avoid providing full articles, long verbatim passages, or extensive direct quotes due to copyright concerns.
  - If the user asked for a verbatim quote, the response should provide a short compliant excerpt and then answer with paraphrases and summaries.
  - Again, this limit does not apply to reddit content, as long as it's appropriately indicated that those are direct quotes and you link to the source.
```

**Parameters.** The JSON schema is generated at runtime from the Rust struct `SearchCommands` (`codex-api/src/search.rs` lines 31 to 213) by `schemars` (`ext/web-search/src/schema.rs`). The Rust doc comments become the field descriptions, and the schema is deliberately parsed "without compaction" so the descriptions survive (`tool.rs` line 94). `strict` is `false`. Nothing at the top level is required; every command is an optional array, so one call can carry several commands of several kinds. The table below is a faithful transcription; the exact JSON key order of the generated schema is not reproduced.

Top level (`SearchCommands`):

| Field | Type | Required | Description (verbatim doc comment) |
|---|---|---|---|
| `search_query` | array of `SearchQuery` | no | Query the internet search engine for a given list of queries. |
| `image_query` | array of `SearchQuery` | no | Query the image search engine for a given list of queries. |
| `open` | array of `OpenOperation` | no | Open pages by reference id or URL. |
| `click` | array of `ClickOperation` | no | Open links from previously opened pages. |
| `find` | array of `FindOperation` | no | Find text patterns in pages. |
| `screenshot` | array of `ScreenshotOperation` | no | Take screenshots of PDF pages. |
| `finance` | array of `FinanceOperation` | no | Look up prices for the given stock symbols. |
| `weather` | array of `WeatherOperation` | no | Look up weather forecasts. |
| `sports` | array of `SportsOperation` | no | Look up sports schedules and standings. |
| `time` | array of `TimeOperation` | no | Get time for the given UTC offsets. |
| `response_length` | enum `short` \| `medium` \| `long` | no | Set the length of the response to be returned. |

Nested objects:

| Object.field | Type | Required | Description (verbatim) |
|---|---|---|---|
| `SearchQuery.q` | string | yes | Search query. |
| `SearchQuery.recency` | integer (u64) | no | Whether to filter by recency, as a number of recent days. |
| `SearchQuery.domains` | array of string | no | Whether to filter by a specific list of domains. |
| `OpenOperation.ref_id` | string | yes | Reference id or URL to open. |
| `OpenOperation.lineno` | integer | no | Line number to position the page at. |
| `ClickOperation.ref_id` | string | yes | Reference id containing the numbered link. |
| `ClickOperation.id` | integer | yes | Numbered link id to open. |
| `FindOperation.ref_id` | string | yes | Reference id or URL to search within. |
| `FindOperation.pattern` | string | yes | Text pattern to find. |
| `ScreenshotOperation.ref_id` | string | yes | Reference id or URL to screenshot. |
| `ScreenshotOperation.pageno` | integer | yes | Zero-indexed PDF page number. |
| `FinanceOperation.ticker` | string | yes | Ticker symbol to look up. |
| `FinanceOperation.type` | enum `equity` \| `fund` \| `crypto` \| `index` | yes | Asset type to look up. |
| `FinanceOperation.market` | string | no | ISO 3166-1 alpha-3 country code, "OTC", or "" for cryptocurrency. |
| `WeatherOperation.location` | string | yes | Location in "Country, Area, City" format. |
| `WeatherOperation.start` | string | no | Start date in YYYY-MM-DD format. Defaults to today. |
| `WeatherOperation.duration` | integer | no | Number of days to return. Defaults to 7. |
| `SportsOperation.tool` | enum `sports` | no | Tool name for sports requests. |
| `SportsOperation.fn` | enum `schedule` \| `standings` | yes | Sports function to call. |
| `SportsOperation.league` | enum `nba` \| `wnba` \| `nfl` \| `nhl` \| `mlb` \| `epl` \| `ncaamb` \| `ncaawb` \| `ipl` | yes | League to look up. |
| `SportsOperation.team` | string | no | Team to look up, using the common 3 or 4 letter alias used in broadcasts. |
| `SportsOperation.opponent` | string | no | Opponent to use with `team` when narrowing the lookup. |
| `SportsOperation.date_from` | string | no | Start date in YYYY-MM-DD format. |
| `SportsOperation.date_to` | string | no | End date in YYYY-MM-DD format. |
| `SportsOperation.num_games` | integer | no | Number of games to return. |
| `SportsOperation.locale` | string | no | Locale for the lookup. |
| `TimeOperation.utc_offset` | string | yes | UTC offset formatted like "+03:00". |

**What it does when called** (`ext/web-search/src/tool.rs` lines 131 to 224):

1. It parses the arguments into `SearchCommands`. Empty arguments become an empty command set; malformed JSON is returned to the model as an error it can fix (`RespondToModel`).
2. It builds a `SearchRequest` (`codex-api/src/search.rs` line 9) with these fields:
   - `id`: the session id.
   - `model`: the name of the model that made the call. The search server is told which model is asking.
   - `input`: a tail of the conversation built by `recent_input` (`ext/web-search/src/history.rs` lines 14 to 27). It keeps the previous user text message, at most 1,000 tokens of the assistant text that followed it (`ASSISTANT_CONTEXT_TOKEN_LIMIT = 1_000`), and the current user text message. Tool calls, tool outputs and images are dropped. So the search server sees what the user asked, not only the query strings.
   - `commands`: the parsed commands.
   - `settings`: approximate user location, `search_context_size` (`low`/`medium`/`high`), an allowed-domains filter, `allowed_callers: ["direct"]`, and `external_web_access` (see below). These come from the user's config (`ext/web-search/src/extension.rs` lines 55 to 92).
   - `max_output_tokens`: the model's truncation budget, which is 10,000 tokens for every catalog model.
3. It posts the request to `alpha/search` and receives `{ "encrypted_output": ..., "output": "<text>", "results": [...] }` (`SearchResponse`, `codex-api/src/search.rs` line 297).
4. The model receives only `output`, as one plain `input_text` item (`ext/web-search/src/output.rs` lines 30 to 40). The structured `results` array (each with `type`, `ref_id`, `url`, `title`, `snippet`) goes only to the UI and to telemetry, never to the model.

The `external_web_access` setting comes from the user's `web_search` mode. The default mode is `cached` (`protocol/src/config_types.rs` line 376, `#[default] Cached`), which maps to `external_web_access: false`, meaning results come from OpenAI's cache or index rather than live fetches. `live` maps to `true`, and `indexed` maps to the mode `"indexed"` ("restricts live fetches to indexed URLs", per the comment at `tools/src/tool_spec.rs` line 37).

The tool is marked as safe to run in parallel with other tools (`supports_parallel_tool_calls: true`).

**What the model gets back (partly inferred).** The client code treats `output` as an opaque string, so its exact format is decided by OpenAI's server and is not in this repository. The tests only mock it as `"Search result"`. From the tool description we can infer that the text labels every result and every opened page with a reference id of the form `turn{N}search{M}`, `turn{N}fetch{M}` or `turn{N}view{M}`, that opened pages are addressed by line number (`lineno`) and carry numbered links (`click` takes a link `id`), and that each web source carries a `[wordlim N]` label. The mock `results` entry in `app-server/tests/suite/v2/web_search.rs` line 381 shows the structured shape the UI gets:

```json
{
  "encrypted_output": "ciphertext",
  "output": "Search result",
  "results": [{
    "type": "text_result",
    "ref_id": "turn0search0",
    "url": "https://example.com/search-result",
    "title": "Search Result",
    "snippet": "A result snippet"
  }]
}
```

**Prompt rules elsewhere.** The base prompt `models-manager/prompt.md` says nothing about web search. The per-model instruction templates in `models.json` also do not mention `web.run`. The MCP resource tools' descriptions say "Prefer resources over web search when possible." All other web guidance lives inside the `web.run` description itself (decision boundary, citations, word limits).

---

## 2. `web_search` (OpenAI hosted tool)

**Where it runs.** Entirely on OpenAI's Responses API servers. Codex only adds a tool entry of type `web_search` to the request. The model's tool description and the result format for this tool are defined server-side and cannot be read from the repository.

**Description.** None is sent by Codex. The hosted tool type carries no client-side description.

**Parameters (what Codex sends, not what the model fills in).** Built by `create_web_search_tool` (`core/src/tools/hosted_spec.rs` lines 14 to 49) and serialized by `ToolSpec::WebSearch` (`tools/src/tool_spec.rs` line 40). Example for the default `cached` mode and a model with `web_search_tool_type: text_and_image`:

```json
{"type": "web_search", "external_web_access": false, "search_content_types": ["text", "image"]}
```

| Field | Value |
|---|---|
| `external_web_access` | `false` for `cached`, `true` for `live` and `indexed` |
| `indexed_web_access` | `true` only for `indexed` |
| `filters` | allowed domains from the user's `[tools.web_search]` config |
| `user_location` | approximate location from config |
| `search_context_size` | `low` / `medium` / `high` from config |
| `search_content_types` | `["text", "image"]` when the model's catalog entry says `text_and_image` |

**What it does when called.** Codex does not execute it. The Responses API runs the search and inserts `web_search_call` items into the conversation; Codex only turns them into UI events. The mode is disabled entirely when `web_search = "disabled"`, and it is downgraded when the sandbox has no network (`resolve_web_search_mode_for_turn`, `core/src/config/mod.rs` line 3013).

**Prompt rules elsewhere.** None in the repository.

---

## 3. `exec` (code mode)

**Where it runs.** In a fresh V8 isolate in the Codex process (the `code-mode-runtime` crate). It is a **freeform tool** (an OpenAI Responses API feature where the model writes raw text constrained by a grammar instead of JSON arguments).

**Description, verbatim.** The fixed part is `EXEC_DESCRIPTION_TEMPLATE` (`code-mode-protocol/src/description.rs` lines 15 to 39). When `code_mode_only` is true, `build_exec_tool_description` (line 261) appends one section per nested tool: a `### \`name\`` heading, the nested tool's own description, and an `exec tool declaration:` block with a TypeScript signature such as `declare const tools: { web__run(args: {...}): Promise<unknown>; };` (lines 394 to 454). Namespaces get a `## namespace` heading with their description.

```text
Run JavaScript code to orchestrate/compose tool calls
- Evaluates the provided JavaScript code in a fresh V8 isolate as an async module.
- All nested tools are available on the global `tools` object, for example `await tools.exec_command(...)`. Tool names are exposed as normalized JavaScript identifiers, for example `await tools.mcp__ologs__get_profile(...)`.
- Nested tool methods take either a string or an object as their input argument.
- Nested tools return either an object or a string, based on the description.
- Runs raw JavaScript -- no Node, no file system, no network access, no console.
- Accepts raw JavaScript source text, not JSON, quoted strings, or markdown code fences.
- You may optionally start the tool input with a first-line pragma like `// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}`.
- `yield_time_ms` asks `exec` to yield early if the script is still running. Defaults to 10000 ms.
- `max_output_tokens` sets the token budget for direct `exec` results. Defaults to 10000 tokens.
- When the JS code is fully evaluated, the isolate's lifetime ends and unawaited promises are silently discarded.

- Global helpers:
- `exit()`: Immediately ends the current script successfully (like an early return from the top level).
- `text(value: string | number | boolean | undefined | null)`: Appends a text item. Non-string values are stringified with `JSON.stringify(...)` when possible.
- `image(imageUrlOrItem: string | { image_url: string; detail?: "auto" | "low" | "high" | "original" | null } | ImageContent, detail?: "auto" | "low" | "high" | "original" | null)`: Appends an image item. `image_url` should be a base64-encoded `data:` URL. To forward an MCP tool image, pass an individual `ImageContent` block from `result.content`, for example `image(result.content[0])`. MCP image blocks may request detail with `_meta: { "codex/imageDetail": "original" }`. When provided, the second `detail` argument overrides any detail embedded in the first argument.
- `audio(audioUrlOrItem: string | { audio_url: string } | AudioContent)`: Appends an audio item. `audio_url` should be a base64-encoded `data:` URL. To forward an MCP tool audio block, pass an individual `AudioContent` block from `result.content`, for example `audio(result.content[0])`.
- `generatedImage(result: { image_url: string; output_hint?: string })`: Appends an image-generation result and its optional output hint. HTTP(S) URLs are not supported.
- `store(key: string, value: any)`: stores a serializable value under a string key for later `exec` calls in the same session.
- `load(key: string)`: returns the stored value for a string key, or `undefined` if it is missing.
- `notify(value: string | number | boolean | undefined | null)`: immediately injects an extra `custom_tool_call_output` for the current `exec` call. Values are stringified like `text(...)`.
- `setTimeout(callback: () => void, delayMs?: number)`: schedules a callback to run later and returns a timeout id. Pending timeouts do not keep `exec` alive by themselves; await an explicit promise if you need to wait for one.
- `clearTimeout(timeoutId?: number)`: cancels a timeout created by `setTimeout`.
- `ALL_TOOLS`: metadata for the enabled nested tools as `{ name, description }` entries.
- `yield_control()`: yields the accumulated output to the model immediately while the script keeps running.
```

When some nested tools are deferred (loaded only on demand), this paragraph is added (line 11):

```text
Some deferred nested tools may be omitted from this description. They are still available on the global `tools` object and listed in `ALL_TOOLS`.
To find one, filter `ALL_TOOLS` by `name` and `description`.
```

**Parameters.** Freeform text constrained by this Lark grammar (`core/src/tools/code_mode/execute_spec.rs` lines 16 to 24):

```text
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
```

**What it does when called.** It evaluates the JavaScript. Each `await tools.X(...)` dispatches the nested tool through the normal tool router, so approvals and sandboxing still apply. Only what the script passes to `text()`, `image()` and the other helpers reaches the model, so the model can filter a large tool result inside JavaScript before it ever enters the context. Output is capped at 10,000 tokens by default. If the script runs longer than `yield_time_ms`, the result says `Script running with cell ID ...` and the model continues with `wait`. The result header has the form `{status}\nWall time {seconds:.1} seconds\nOutput:\n` (`core/src/tools/code_mode/mod.rs` line 323).

**Prompt rules elsewhere.** From the `gpt-6-astra` instruction template in `models.json`:

```text
- Batch independent searches and reads in one functions.exec using await Promise.allSettled([...]); inspect every result. Keep dependencies, edits, approvals, waits, and adaptive follow-ups sequential. Avoid unnecessary output.
- When calling `functions.exec`, parallelize independent tool calls by awaiting Promises. Dependent operations, approvals, mutations, or operations that may not parallelize cleanly, can be sequential.
```

## 4. `wait` (code mode)

**Where it runs.** Codex process.

**Description, verbatim** (`core/src/tools/code_mode/wait_spec.rs` line 33 plus `WAIT_DESCRIPTION_TEMPLATE`):

```text
Waits on a yielded `exec` cell and returns new output or completion.
- Use `wait` only after `exec` returns `Script running with cell ID ...`.
- `cell_id` identifies the running `exec` cell to resume.
- `yield_time_ms` controls how long to wait for more output before yielding again. Defaults to 10000 ms.
- `max_tokens` limits how much new output this wait call returns. Defaults to 10000 tokens.
- `terminate: true` stops the running cell; false or omitted waits for output.
- `wait` returns only the new output since the last yield, or the final completion or termination result for that cell.
- If the cell is still running, `wait` may yield again with the same `cell_id`.
- If the cell has already finished, `wait` returns the completed result and closes the cell.
```

**Parameters.**

| Name | Type | Required | Description |
|---|---|---|---|
| `cell_id` | string | yes | Identifier of the running exec cell. |
| `yield_time_ms` | number | no | Wait before yielding more output. Defaults to 10000 ms. |
| `max_tokens` | number | no | Output token budget for this wait call. Defaults to 10000 tokens. |
| `terminate` | boolean | no | True stops the running exec cell; false or omitted waits for output. |

---

## 5. `exec_command`

**Where it runs.** Codex process, in a sandboxed shell ("unified exec", a Codex term for a PTY-backed process manager that can keep processes alive across calls).

**Description, verbatim** (`core/src/tools/handlers/shell_spec.rs` line 103):

```text
Runs a command in a PTY, returning output or a session ID for ongoing interaction.
```

On Windows hosts a block of "Windows safety rules" is appended (lines 339 to 344); it is about destructive file commands and is omitted here.

**Parameters** (lines 35 to 93, plus the approval parameters at lines 232 to 278). `additionalProperties: false`, `cmd` required.

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `cmd` | string | yes | Shell command to execute. |
| `workdir` | string | no | Working directory for the command. Defaults to the turn cwd. |
| `tty` | boolean | no | True allocates a PTY for the command; false or omitted uses plain pipes. |
| `yield_time_ms` | number | no | Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms. |
| `max_output_tokens` | number | no | Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy. |
| `shell` | string | no (conditional) | Shell binary to launch. Defaults to the user's default shell. |
| `login` | boolean | no (conditional) | True runs the shell with -l/-i semantics; false disables them. Defaults to true. |
| `environment_id` | string | no (only with several environments) | Environment id from <environment_context>. Omit to use the primary environment. |
| `sandbox_permissions` | enum `use_default` \| (`with_additional_permissions`) \| `require_escalated` | no | Per-command sandbox override. Defaults to `use_default`; use `require_escalated` for unsandboxed execution. |
| `justification` | string | no | User-facing approval question for `require_escalated`; omit otherwise. |
| `prefix_rule` | array of string | no | Reusable approval prefix for `cmd`, only with `sandbox_permissions: "require_escalated"`; for example ["git", "pull"]. |
| `additional_permissions` | object | no (feature-flagged) | Sandboxed filesystem or network access for this command; only with `sandbox_permissions: "with_additional_permissions"`. |

The tool also declares an output schema (`unified_exec_output_schema`, line 198) with `chunk_id`, `wall_time_seconds`, `exit_code`, `session_id`, `original_token_count` and `output`. That schema is used for code mode's TypeScript types.

**What it does when called.** Starts the process and waits up to `yield_time_ms`, clamped to 250 to 30,000 ms (`core/src/unified_exec/mod.rs` lines 73 to 83). At most 64 live processes (`MAX_UNIFIED_EXEC_PROCESSES`), and at most 1 MiB of output is buffered. If the process is still running, the result carries a session id for `write_stdin`. Output is middle-truncated to `max_output_tokens` (default 10,000). The text the model sees is built by `response_header` (`core/src/tools/context.rs` lines 514 to 538). Reconstructed example:

```text
Chunk ID: 3f2a
Wall time: 0.4123 seconds
Process exited with code 0
Original token count: 18234
Output:
Warning: truncated output (original token count: 18234)
<first part of the output>…8234 tokens truncated…<last part of the output>
```

**Prompt rules elsewhere** (`models-manager/prompt.md` lines 260 to 265):

```text
## Shell commands

When using the shell, you must adhere to the following guidelines:

- When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`. (If the `rg` command is not found, then use alternatives.)
- Do not use python scripts to attempt to output larger chunks of a file.
```

The `gpt-5.5` template adds:

```text
- You parallelize tool calls whenever you can, especially file reads such as `cat`, `rg`, `sed`, `ls`, `git show`, `nl`, and `wc`. You use `multi_tool_use.parallel` for that parallelism, and only that. Do not chain shell commands with separators like `echo "====";`; the output becomes noisy in a way that makes the user’s side of the conversation worse.
```

(`multi_tool_use.parallel` is a wrapper tool injected by OpenAI's API, not defined in this repository. Codex only reserves the name, `core/src/config/mod.rs` line 3087.)

## 6. `write_stdin`

**Where it runs.** Codex process.

**Description, verbatim** (`shell_spec.rs` line 148):

```text
Writes characters to an existing unified exec session and returns recent output.
```

**Parameters.** `session_id` required.

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `session_id` | number | yes | Identifier of the running unified exec session. |
| `chars` | string | no | Bytes to write to stdin. Defaults to empty, which polls without writing. |
| `yield_time_ms` | number | no | Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default. |
| `max_output_tokens` | number | no | Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy. |

**What it does.** Same output format as `exec_command`. An empty write is a poll with a minimum wait of 5,000 ms (`MIN_EMPTY_YIELD_TIME_MS`) and a default ceiling of 300,000 ms.

## 7. `apply_patch`

**Where it runs.** Codex process (the `apply-patch` crate).

**Description, verbatim** (`core/src/tools/handlers/apply_patch_spec.rs` line 20):

```text
The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.
```

**Parameters.** Freeform text constrained by `core/assets/tools/apply_patch.lark`:

```text
start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
```

**Prompt rules elsewhere** (`prompt.md` lines 132 and 143):

```text
- Use the `apply_patch` tool to edit files (NEVER try `applypatch` or `apply-patch`, only `apply_patch`): {"command":["apply_patch","*** Begin Patch\\n*** Update File: path/to/file.py\\n@@ def example():\\n- pass\\n+ return 123\\n*** End Patch"]}
```

```text
- Do not waste tokens by re-reading files after calling `apply_patch` on them. The tool call will fail if it didn't work. The same goes for making folders, deleting folders, etc.
```

---

## 8. `update_plan`

**Where it runs.** Codex process. It changes nothing except the UI.

**Description, verbatim** (`core/src/tools/handlers/plan_spec.rs` lines 44 to 47):

```text
Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
```

**Parameters.** `plan` required, `additionalProperties: false`.

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `explanation` | string | no | Optional explanation for this plan update. |
| `plan` | array of objects | yes | The list of steps |
| `plan[].step` | string | yes | Task step text. |
| `plan[].status` | enum `pending` \| `in_progress` \| `completed` | yes | Step status. |

**What it does when called** (`core/src/tools/handlers/plan.rs` lines 66 to 99). It parses the arguments, sends a `PlanUpdate` event to the UI, and returns the fixed text `Plan updated`. The plan is not stored anywhere the model can read back later; the model's own earlier call in the history is its only memory of the plan. In Plan mode (a separate collaboration mode) it returns the error `update_plan is a TODO/checklist tool and is not allowed in Plan mode`. The tool is present unless the user config turns it off (`update_plan_enabled`).

**Prompt rules elsewhere** (`models-manager/prompt.md` lines 52 to 121 and 267 to 275), verbatim:

```text
## Planning

You have access to an `update_plan` tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you've understood the task and convey how you're approaching it. Plans can help to make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good plan should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that plans are not for padding out simple work with filler steps or stating the obvious. The content of your plan should not involve doing anything that you aren't capable of doing (i.e. don't try to test things that you can't test). Do not use plans for simple or single-step queries that you can just do or answer immediately.

Do not repeat the full contents of the plan after an `update_plan` call — the harness already displays it. Instead, summarize the change made and highlight any important context or next step.

Before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed before moving on to the next step. It may be the case that you complete all steps in your plan after a single pass of implementation. If this is the case, you can simply mark all the planned steps as completed. Sometimes, you may need to change plans in the middle of a task: call `update_plan` with the updated plan and make sure to provide an `explanation` of the rationale when doing so.

Use a plan when:

- The task is non-trivial and will require multiple actions over a long time horizon.
- There are logical phases or dependencies where sequencing matters.
- The work has ambiguity that benefits from outlining high-level goals.
- You want intermediate checkpoints for feedback and validation.
- When the user asked you to do more than one thing in a single prompt
- The user has asked you to use the plan tool (aka "TODOs")
- You generate additional steps while working, and plan to do them before yielding to the user

### Examples

**High-quality plans**

Example 1:

1. Add CLI entry with file args
2. Parse Markdown via CommonMark library
3. Apply semantic HTML template
4. Handle code blocks, images, links
5. Add error handling for invalid files

Example 2:

1. Define CSS variables for colors
2. Add toggle with localStorage state
3. Refactor components to use variables
4. Verify all views for readability
5. Add smooth theme-change transition

Example 3:

1. Set up Node.js + WebSocket server
2. Add join/leave broadcast events
3. Implement messaging with timestamps
4. Add usernames + mention highlighting
5. Persist messages in lightweight DB
6. Add typing indicators + unread count

**Low-quality plans**

Example 1:

1. Create CLI tool
2. Add Markdown parser
3. Convert to HTML

Example 2:

1. Add dark mode toggle
2. Save preference
3. Make styles look good

Example 3:

1. Create single-file HTML game
2. Run quick sanity check
3. Summarize usage instructions

If you need to write a plan, only write high quality plans, not low quality ones.
```

```text
## `update_plan`

A tool named `update_plan` is available to you. You can use it to keep an up‑to‑date, step‑by‑step plan for the task.

To create a new plan, call `update_plan` with a short list of 1‑sentence steps (no more than 5-7 words each) with a `status` for each step (`pending`, `in_progress`, or `completed`).

When steps have been completed, use `update_plan` to mark each finished step as `completed` and the next step you are working on as `in_progress`. There should always be exactly one `in_progress` step until everything is done. You can mark multiple items as complete in a single `update_plan` call.

If all steps are complete, ensure you call `update_plan` to mark all steps as `completed`.
```

When `update_plan` is disabled, `prompts/src/update_plan_instructions.rs` strips these sections from Codex-owned prompts.

## 9. `view_image`

**Where it runs.** Codex process. It reads a local file only; it cannot fetch a URL.

**Description, verbatim** (`core/src/tools/handlers/view_image_spec.rs` line 44):

```text
View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.
```

**Parameters.** `path` required.

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `path` | string | yes | Local filesystem path to an image file. |
| `detail` | enum `high` \| `original` | no (only for models that support original detail) | Image detail level. Defaults to `high`; use `original` to preserve exact resolution. |
| `environment_id` | string | no (only with several environments) | Environment id from <environment_context>. Omit to use the primary environment. |

**What it does when called** (`core/src/tools/handlers/view_image.rs` lines 93 to 212). If the model has no image input it returns `view_image is not allowed because you do not support image inputs`. Otherwise it resolves the path against the environment's working directory, checks the file exists and decodes as an image, and returns the bytes as a `data:` URL inside an `input_image` content item with detail `high` or `original`. Resizing happens later when the item is inserted into history. It is gated by the `ViewImage` feature.

## 10. `tool_search`

**Where it runs.** Codex process (`execution: "client"`). It is a special Responses API tool type (`ToolSpec::ToolSearch`), not an ordinary function.

**Description, verbatim** (`core/src/tools/handlers/tool_search_spec.rs` lines 86 to 95). Rendered example from the unit test at line 141:

```text
# Tool discovery

Searches over deferred tool metadata with BM25 and exposes matching tools for the next model call.

You have access to tools from the following sources:
- Google Drive: Use Google Drive as the single entrypoint for Drive, Docs, Sheets, and Slides work.
- docs
Some of the tools may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools. For MCP tool discovery, always use `tool_search` instead of `list_mcp_resources` or `list_mcp_resource_templates`.
```

The source list is capped at 512 KiB, and it is omitted entirely when the `DeferredToolWorldState` feature advertises sources elsewhere.

**Parameters.**

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `query` | string | yes | Search query for deferred tools. |
| `limit` | number | no | Maximum number of tools to return. Defaults to 8. |

**What it does when called** (`core/src/tools/handlers/tool_search.rs` lines 191 to 257). It runs a BM25 search (the `bm25` crate) over the metadata of deferred tools and returns up to `limit` (default `TOOL_SEARCH_DEFAULT_LIMIT = 8`, `tools/src/tool_discovery.rs` line 7) full tool specs, which then become callable on the next model call. It is only registered when at least one tool is deferred and the model supports it (`supports_search_tool`).

---

## 11. `clock.curr_time` (feature-flagged)

**Where it runs.** Codex process. Registered when the `CurrentTimeReminder` feature is on or the model's catalog entry lists `"clock"` in `experimental_supported_tools` (`gpt-6-astra` does).

**Description, verbatim** (`core/src/tools/handlers/current_time.rs` lines 57 to 62). Namespace `clock`, namespace description `Tools for reading and waiting on time.`, tool description:

```text
Return the current time in UTC.
```

**Parameters.** None (empty object, `additionalProperties: false`). Output schema: `current_time`, "Current UTC time formatted as YYYY-MM-DD HH:MM:SS UTC."

**What it does.** Reads the session's time provider and returns the text `It is 2026-09-23 22:04:11 UTC.` (format `%Y-%m-%d %H:%M:%S UTC`, `core/src/context/current_time_reminder.rs` lines 18 and 41). On failure it returns `failed to read current time`.

## 12. `clock.sleep` (feature-flagged)

**Description, verbatim** (`core/src/tools/handlers/sleep.rs` line 51):

```text
Pause execution for a specified duration. The sleep ends early when new input arrives for the active turn. Returns the elapsed wall-clock time.
```

**Parameters.** `duration_ms` (number, required): "How long to sleep in milliseconds. Must be between 1 and 43200000." (the maximum is 12 hours, `MAX_SLEEP_DURATION_MS`).

## 13. `get_context_remaining` (feature `TokenBudget`)

**Where it runs.** Codex process.

**Description, verbatim** (`core/src/tools/handlers/get_context_remaining_spec.rs` line 13):

```text
Get the remaining tokens in the current context window.
```

**Parameters.** None. Output schema: `tokens_left`, integer or null, "Remaining tokens in the current context window, or null when unavailable."

**What it does** (`core/src/tools/handlers/get_context_remaining.rs` lines 74 to 90). It computes the tokens left in the base context window and returns the text `You have 51234 tokens left in this context window.` or `You have unknown tokens left in this context window.` (`core/src/context/token_budget_context.rs` lines 167 to 174).

## 14. `new_context` (feature `TokenBudget`)

**Description, verbatim** (`core/src/tools/handlers/new_context_window_spec.rs` line 11):

```text
Start a new context window. Does not clear, reset, or otherwise affect environment state.
```

**Parameters.** None.

**What it does.** Starts a new context window. The previous window's messages are dropped. Only the model's notes (a `notes` tool from a history-notes extension) and a read-only `history` tool survive, according to the catalog prompts below. The `notes` and `history` tools are not in this repository's core tool list; they come from an extension (`use_history_notes_extension`), so their definitions were not read.

**Prompt rules elsewhere** (budget awareness). The bundled default reminder, injected as a developer message when the window is nearly full (`prompts/src/model_messages.rs` line 48):

```text
Your context window is nearly exhausted (only {n_remaining} tokens remaining) and will be automatically reset for you soon. Once reset, message items in current context window will be cleared in the new window, but notes and history items will be persistent across windows.
```

The `gpt-6-astra` catalog entry overrides it (token budget is `"enabled": false` there by default, `reminder_threshold_tokens: 6144`):

```text
<context_window_reminder>
Your current context window is nearly exhausted; only {n_remaining} tokens remain. Before starting a new context window, save concise progress notes with the `notes` tool with the goal, decisions, progress, learnings, next steps, and the window ID and item ID of every relevant user request still being solved, as well as important actions/tool calls for future reference. Note that every non-assistant item, such as user, developer, tool response, has an item id `[id: ...]` that is immediately after its item content. You should write or append notes in a way to best help you recover in a new context window. It is also a good idea to clean up your old notes if they become obsolete or irrelevant. Future context windows will not automatically include the current conversation. After saving your state, call `functions.new_context` to continue in a fresh context window.
</context_window_reminder>
```

and adds this guidance message:

```text
For tasks that may span context windows, use `notes` to maintain a concise checkpoint of the goal, decisions, progress, learnings and next steps. Include the window ID and item ID for every relevant user request you are currently solving as well as important actions/tool calls. You can use `history` tool to look up details with the references later. Note that every non-assistant item, such as user, developer, tool response, has an item id `[id: ...]` that is immediately after its item content. Relative note paths belong to the current thread; absolute paths may read other threads' notes, but writes are limited to the current thread.

It is a good idea to take incremental notes while you work so that you do not miss any important info. You can also use `get_context_remaining` tool to find the remaining token budget for better planning. Once the token budget is exhausted, you will lose access to the current window and continue in a fresh context window and you can only recover through `notes` and `history` tools. So be careful not to over-run the context window without any documentation.

If Previous context window id is present in `<context_window>`, it means a context reset occurred and this is a new window. After a reset, read the checkpoint and use the read-only `history` tool to recover any missing details. When a window ID and item ID are known, prefer `read_item` directly; when they are missing or uncertain, use `list_items`, or `search_contents` to locate the item first.

Treat notes and history as internal bookkeeping. Do not mention them in user-facing messages.
```

and a last-resort prompt when the window is already exhausted:

```text
<context_window_reminder>
The current context window is exhausted. Do not continue the task or give a final answer in this window. The next window will not automatically include this conversation. Make exactly one write or append call to `notes` now to save a concise checkpoint with the goal, decisions, progress, learnings, next steps, and the window ID and item ID of every relevant user request still being solved, as well as important actions/tool calls for future reference. Note that every non-assistant item, such as user, developer, tool response, has an item id `[id: ...]` that is immediately after its item content. After the notes result returns, call `functions.new_context`; do not use any tools other than `notes` and `functions.new_context`.
</context_window_reminder>
```

When `TokenBudget` is off, the `gpt-5.5` template instead says: "When you run out of context, the tool automatically compacts the conversation. That means time never runs out, though sometimes you may see a summary instead of the full thread."

---

## 15. `request_user_input` (feature-flagged, default on)

**Description, verbatim** (`core/src/tools/handlers/request_user_input_spec.rs` line 126). `{allowed_modes}` is filled with the collaboration modes that allow it, which by default is Plan mode only (inferred from `tools/src/tool_config.rs` line 17):

```text
Request user input for one to three short questions and wait for the response. This tool is only available in {allowed_modes}.
```

**Parameters.** `questions` (array, required): "Questions to show the user. Prefer 1 and do not exceed 3". Each question has `id` ("Stable identifier for mapping answers (snake_case)."), `header` ("Short header label shown in the UI (12 or fewer chars)."), `question` ("Single-sentence prompt shown to the user."), and `options`: "Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with \"(Recommended)\". Do not include an \"Other\" option in this list; the client will add a free-form \"Other\" option automatically." Each option has `label` ("User-facing label (1-5 words).") and `description` ("One short sentence explaining impact/tradeoff if selected."). All four question fields are required.

## 16. `request_user_input_async` and `send_message_to_user_async`

Only for root agents and only when the model catalog lists them (`gpt-6-astra` lists `send_user_message_async`).

`request_user_input_async` description (`prompts/src/model_messages.rs` line 47):

```text
Ask the user one or more questions during ongoing work. Use this tool only to request missing information, preferences, constraints, clarification, or approval. The tool returns immediately without ending the turn or waiting for a reply; any reply arrives asynchronously as a new user message. Keep questions concise, self-contained, and easy to understand, using a level of detail appropriate to the user and task. The UI always allows a free-text answer, including when suggested options are provided. A preselected option is not submitted automatically.
```

Parameters: `questions` (array, at least 1): "One or more self-contained questions to present together, in display order." Each has `title` (required): "The complete question shown to the user, including any context needed to answer it." and `options` (array of strings, at least 1): "Suggested answers, in display order. Put the recommended answer first; the first option is preselected by default. The user can select one option or enter a free-text answer. Do not include an Other option or a free-text placeholder; the UI provides free-text input automatically. Omit options for a free-text-only question."

`send_message_to_user_async` description (`core/src/tools/handlers/send_message_to_user_async.rs` line 46):

```text
Send a concise message that needs the user's attention during ongoing work. The tool returns immediately without ending the turn or waiting for a reply; any reply arrives asynchronously as a new user message. Use this tool to report a critical blocker or a finding that may change the task's direction, or to answer a user question or status request received while work is still in progress. Use this tool when a message needs the user's immediate attention; use commentary for routine progress and intermediate context. Use clear formatting, such as bolding questions, to make requests easy to notice and answer.
```

Parameter: `message` (string, required): "The concise question or update to send to the user."

---

## 17. Sub-agents, version 1 (namespace `multi_agent_v1`)

**Where they run.** Each sub-agent is a separate Codex thread (a full agent loop) in the same process. The namespace description is `Tools for spawning and managing sub-agents.` Defaults: at most 6 agent threads (`DEFAULT_AGENT_MAX_THREADS`) and a spawn depth of 1 (`DEFAULT_AGENT_MAX_DEPTH`), so a sub-agent cannot spawn its own sub-agents by default (`core/src/config/mod.rs` lines 251 and 261). When `tool_search` is available these tools are deferred rather than listed up front (`spec_plan.rs` line ~1300).

### `spawn_agent` (v1)

**Description, verbatim** (`core/src/tools/handlers/multi_agents_spec.rs`, `spawn_agent_tool_description`). The first line is the list of available model overrides, which depends on runtime data; its template is `Available model overrides (optional; inherited parent model is preferred):\n- \`{model_slug}\`: {description} Reasoning efforts: {efforts}. Service tiers: {tiers}.` for up to 5 picker-visible models. The source indents the first lines with spaces; they are shown without indentation here.

```text
{available model overrides, see above}
Spawn a sub-agent for a well-scoped task. Returns the spawned agent id plus the user-facing nickname when available. Spawned agents inherit your current model by default. Omit `model` to use that preferred default; set `model` only when an explicit override is needed.
This spawn_agent tool provides you access to sub-agents that inherit your current model by default. Do not set the `model` field unless the user explicitly asks for a different model. You should follow the rules and guidelines below to use this tool.
Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.
Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.
Agent-role guidance below only helps choose which agent to use after spawning is already authorized; it never authorizes spawning by itself.
### When to delegate vs. do the subtask yourself
- First, quickly analyze the overall user task and form a succinct high-level plan. Identify which tasks are immediate blockers on the critical path, and which tasks are sidecar tasks that are needed but can run in parallel without blocking the next local step. As part of that plan, explicitly decide what immediate task you should do locally right now. Do this planning step before delegating to agents so you do not hand off the immediate blocking task to a submodel and then waste time waiting on it.
- Use a subagent when a subtask is easy enough for it to handle and can run in parallel with your local work. Prefer delegating concrete, bounded sidecar tasks that materially advance the main task without blocking your immediate next local step.
- Do not delegate urgent blocking work when your immediate next step depends on that result. If the very next action is blocked on that task, the main rollout should usually do it locally to keep the critical path moving.
- Keep work local when the subtask is too difficult to delegate well and when it is tightly coupled, urgent, or likely to block your immediate next step.
### Designing delegated subtasks
- Subtasks must be concrete, well-defined, and self-contained.
- Delegated subtasks must materially advance the main task.
- Do not duplicate work between the main rollout and delegated subtasks.
- Avoid issuing multiple delegate calls on the same unresolved thread unless the new delegated task is genuinely different and necessary.
- Narrow the delegated ask to the concrete output you need next.
- For coding tasks, prefer delegating concrete code-change worker subtasks over read-only explorer analysis when the subagent can make a bounded patch in a clear write scope.
- When delegating coding work, instruct the submodel to edit files directly in its forked workspace and list the file paths it changed in the final answer.
- For code-edit subtasks, decompose work so each delegated task has a disjoint write set.
### After you delegate
- Call wait_agent very sparingly. Only call wait_agent when you need the result immediately for the next critical-path step and you are blocked until it returns.
- Do not redo delegated subagent tasks yourself; focus on integrating results or tackling non-overlapping work.
- While the subagent is running in the background, do meaningful non-overlapping work immediately.
- Do not repeatedly wait by reflex.
- When a delegated coding task returns, quickly review the uploaded changes, then integrate or refine them.
### Parallel delegation patterns
- Run multiple independent information-seeking subtasks in parallel when you have distinct questions that can be answered independently.
- Split implementation into disjoint codebase slices and spawn multiple agents for them in parallel when the write scopes do not overlap.
- Delegate verification only when it can run in parallel with ongoing implementation and is likely to catch a concrete risk before final integration.
- The key is to find opportunities to spawn multiple independent subtasks in parallel within the same round, while ensuring each subtask is well-defined, self-contained, and materially advances the main task.
```

**Parameters.** No field is required.

| Name | Type | Description (verbatim) |
|---|---|---|
| `message` | string | Initial plain-text task for the new agent. Use either message or items. |
| `items` | array of objects | Structured input items. Use this to pass explicit mentions (for example app:// connector paths). Each item has `type` ("Input item type: text, image, local_image, audio, local_audio, skill, or mention."), `text`, `image_url`, `audio_url`, `path`, `name`. |
| `agent_type` | string (only when roles are configured) | Agent type override for the new agent. Omit to inherit the parent agent type with a full-history fork; otherwise, `default` is used.\n{roles} |
| `fork_context` | boolean | True forks the current thread history into the new agent; false or omitted starts with only the initial prompt. |
| `model` | string | Model override for the new agent. Omit unless an explicit override is needed. |
| `reasoning_effort` | string | Reasoning effort override for the new agent. Omit to inherit the parent effort. |

The `{roles}` text is built by `core/src/agent/role.rs` lines 268 to 334 from the built-in roles `default` ("Default agent."), `explorer` and `worker`. The explorer role description, verbatim:

```text
Use `explorer` for specific codebase questions.
Explorers are fast and authoritative.
They must be used to ask specific, well-scoped questions on the codebase.
Rules:
- In order to avoid redundant work, you should avoid exploring the same problem that explorers have already covered. Typically, you should trust the explorer results without additional verification. You are still allowed to inspect the code yourself to gain the needed context!
- You are encouraged to spawn up multiple explorers in parallel when you have multiple distinct questions to ask about the codebase that can be answered independently. This allows you to get more information faster without waiting for one question to finish before asking the next. While waiting for the explorer results, you can continue working on other local tasks that do not depend on those results. This parallelism is a key advantage of delegation, so use it whenever you have multiple questions to ask.
- Reuse existing explorers for related questions.
```

The worker role description, verbatim:

```text
Use for execution and production work.
Typical tasks:
- Implement part of a feature
- Fix tests or bugs
- Split large refactors into independent chunks
Rules:
- Explicitly assign **ownership** of the task (files / responsibility). When the subtask involves code changes, you should clearly specify which files or modules the worker is responsible for. This helps avoid merge conflicts and ensures accountability. For example, you can say "Worker 1 is responsible for updating the authentication module, while Worker 2 will handle the database layer." By defining clear ownership, you can delegate more effectively and reduce coordination overhead.
- Always tell workers they are **not alone in the codebase**, and they should not revert the edits made by others, and they should adjust their implementation to accommodate the changes made by others. This is important because there may be multiple workers making changes in parallel, and they need to be aware of each other's work to avoid conflicts and ensure a cohesive final product.
```

**What it returns.** `{ "agent_id": "...", "nickname": "..." | null }`. The child runs in the background.

### `send_input`, `resume_agent`, `wait_agent`, `close_agent` (v1)

Descriptions, verbatim:

```text
Send a message to an existing agent. Use interrupt=true to redirect work immediately. You should reuse the agent by send_input if you believe your assigned task is highly dependent on the context of a previous task.
```

```text
Resume a previously closed agent by id so it can receive send_input and wait_agent calls.
```

```text
Wait for agents to reach a final status. Completed statuses may include the agent's final message. Returns empty status when timed out. Once the agent reaches a final status, a notification message will be received containing the same completed status.
```

```text
Close an agent and any open descendants when they are no longer needed, and return the target agent's previous status before shutdown was requested. Completed agents remain open and count toward the concurrency limit until closed. Don't keep agents open for too long if they are not needed anymore.
```

Parameters:
- `send_input`: `target` (required, "Agent id to message (from spawn_agent)."), `message` ("Legacy plain-text message to send to the agent. Use either message or items."), `items`, `interrupt` ("True interrupts the current task and handles this message immediately; false or omitted queues it."). Returns `submission_id`.
- `resume_agent`: `id` (required, "Agent id to resume."). Returns `status`.
- `wait_agent`: `targets` (array, required, "Agent ids to wait on. Pass multiple ids to wait for whichever finishes first."), `timeout_ms` ("Timeout in milliseconds. Defaults to 30000, min 10000, max 3600000. Prefer longer waits (minutes) to avoid busy polling."). Returns `{ status: { <agent_id>: <status> }, timed_out }`, where a status is one of `pending_init`, `running`, `interrupted`, `shutdown`, `not_found`, `{ "completed": "<final message or null>" }`, or `{ "errored": "..." }`. This is the channel through which the sub-agent's final answer reaches the parent.
- `close_agent`: `target` (required, "Agent id to close (from spawn_agent)."). Returns `previous_status`.

## 18. Sub-agents, version 2

In v2 the tools are optionally grouped under a namespace (default name `collaboration`, `core/src/config/mod.rs` line 256). Agents are addressed by task paths such as `/root/task1/task_3`. Defaults: 4 concurrent threads per session, wait timeout default 30,000 ms, min 10,000 ms, max 3,600,000 ms.

**`spawn_agent` (v2) description, verbatim** (default text, used when the model catalog gives no override; `{inherited_model_guidance}` is empty unless model overrides are exposed):

```text
{agent_role_guidance}
Spawns an agent to work on the specified task. If your current task is `/root/task1` and you spawn_agent with task_name "task_3" the agent will have canonical task name `/root/task1/task_3`.
You are then able to refer to this agent as `task_3` or `/root/task1/task_3` interchangeably. However an agent `/root/task2/task_3` would only be able to communicate with this agent via its canonical name `/root/task1/task_3`.
The spawned agent will have the same tools as you and the ability to spawn its own subagents.
{inherited_model_guidance}
Only call this tool for a concrete, bounded subtask that can run independently alongside useful local work; otherwise continue locally.
It will be able to send you and other running agents messages, and its final answer will be provided to you when it finishes.
The new agent's canonical task name will be provided to it along with the message.
Note that passing `fork_turns="none"` will not pass any surrounding context to the spawned subagent, which may cause the agent to lack the context it needs to complete its task, whereas `fork_turns="all"` will provide the subagent with all surrounding context.
```

Parameters (`task_name` and `message` required): `task_name` ("Task name for the new agent. Use lowercase letters, digits, and underscores."), `message` ("Initial plain-text task for the new agent.", marked encrypted), `agent_type` ("Agent type override for the new agent. Omit unless explicitly asked. The selected role applies regardless of how much parent history is inherited.\n{roles}"), `fork_turns` ("Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3` to fork only the most recent turns."), and optionally `model` and `reasoning_effort`. Returns `task_name` and `nickname`.

Other v2 tools, descriptions verbatim:

```text
Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.
```
(`send_message`: `target` "Relative or canonical task name to message (from spawn_agent).", `message` "Message text to queue on the target agent.")

```text
Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle. If the target is already running, deliver the task promptly at message boundaries while sampling, or after the pending tool call completes.
```
(`followup_task`: `target`, `message`)

```text
Wait for a mailbox update from any live agent, including queued messages and final-status notifications. The wait also ends early when new user input is steered into the active turn. Does not return the content; returns either a summary of which agents have updates (if any), an interruption summary for steered input, or a timeout summary if no activity arrives before the deadline.
```
(`wait_agent`: `timeout_ms` "Timeout in milliseconds. Defaults to 30000, min 10000, max 3600000." The handler returns only `Wait completed.`, `Wait interrupted by new input.` or `Wait timed out.` plus `timed_out`, `core/src/tools/handlers/multi_agents_v2/wait.rs` lines 143 to 159. The child's final answer arrives as a separate message in the conversation.)

```text
Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.
```

```text
List live agents in the current root thread tree. Optionally filter by task-path prefix.
```
(`list_agents`: `path_prefix` "Task-path prefix filter without a trailing slash. Omit to list all live agents.")

**Prompt rules elsewhere** (v2 root role message from the `gpt-6-astra` catalog entry, `model_messages.multi_agent.role.root`), verbatim:

````text
You are `/root`, the primary agent in a team of agents collaborating to fulfill the user's goals.

At the start of your turn, you are the active agent.
You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents.
All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable, and have access to the same set of tools.

You can use `spawn_agent` to create a new agent, `followup_task` to give an existing agent a new task and trigger a turn, and `send_message` to pass a message to a running agent without triggering a turn.
`send_message` calls may be read by a human, so ensure they are legible. Always put proper spaces between words and/or numbers.
Child agents can also spawn their own sub-agents.
You can decide how much context you want to propagate to your sub-agents with the `fork_turns` parameter.

You will receive messages in the analysis channel in the form:
```
Message Type: MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
```
They may be addressed as to=/root
````

---

## 19. Other tools (brief)

These do not bear on web research. Descriptions are verbatim.

- `request_permissions` (feature `RequestPermissionsTool`): "Request additional filesystem or network permissions from the user and wait for the client to grant a subset of the requested permission profile. Use environment_id to target a specific attached environment; omit it to use the primary environment. Relative filesystem paths resolve against the selected environment cwd. Granted permissions apply automatically to later shell-like commands in the current turn, or for the rest of the session if the client approves them at session scope." Parameters: `permissions` (required; `network.enabled`, `file_system.read`, `file_system.write`), `reason`, `environment_id`.
- `list_mcp_resources`: "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible." Parameters `server`, `cursor`.
- `list_mcp_resource_templates`: "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible."
- `read_mcp_resource`: "Read a specific resource from an MCP server given the server name and resource URI." Parameters `server` ("MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources."), `uri` ("Resource URI to read. Must be one of the URIs returned by list_mcp_resources.").
- `wait_for_environment` (feature `DeferredExecutor`): "Wait for a selected execution environment marked as `starting` to become available. Use this when the current task needs that environment's files, commands, or installed capabilities. Do not wait if the task can be completed using tools already available, such as connectors. Waiting may take several minutes and blocks other tool calls. If startup fails, continue without that environment."
- `list_available_plugins_to_install` and `request_plugin_install` (feature `ToolSuggest`): plugin and connector installation prompts.
- MCP tools and "dynamic tools" supplied by the client are added as ordinary function tools, deferred behind `tool_search` when the model supports it.

## Things I could not read directly

- The output text format of `web.run` (how results, opened pages, line numbers and `[wordlim N]` labels look) is produced by OpenAI's `alpha/search` service. Only the request shape and the structured `results` side channel are in the repository.
- Whether `alpha/search` runs a model over the results, and which, is not visible. The request carries the caller's model name and a 10,000-token output budget, which suggests (inferred) that a server-side process formats or summarizes the output for that model.
- The hosted `web_search` tool's model-facing description and result format are entirely server-side.
- The `notes` and `history` tools referenced by the token-budget prompts come from an extension that was not part of this read.
