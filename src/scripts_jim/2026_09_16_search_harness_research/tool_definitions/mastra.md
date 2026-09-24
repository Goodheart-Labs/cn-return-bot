# Mastra: research tool definitions

Source: the `mastra` monorepo (TypeScript). Paths below are relative to `sdks/mastra/`. Mastra is a TypeScript agent framework built on the Vercel AI SDK. Its tools are spread over several packages:

- `packages/core/src/tools/builtin/` holds the framework's built-in tools (`web_fetch`, the `webSearchTool` placeholder, task-list tools).
- `packages/core/src/workspace/tools/` holds the "workspace" tools (a workspace, in Mastra's own vocabulary, is a filesystem plus optional sandbox and search index given to an agent). All their ids start with `mastra_workspace_`.
- `packages/memory/src/tools/` holds the memory tools (`updateWorkingMemory`, `recall`).
- `integrations/tavily`, `integrations/parallel` hold wrappers for the Tavily and Parallel search APIs.
- `mastracode/` is Mastra's own coding agent ("Mastra Code"), which shows how the Mastra team wires the web tools together in practice.

## Index

| Tool id (what the model sees) | Runs where | Research role | File |
|---|---|---|---|
| `web_search` via `webSearchTool` placeholder | provider server (OpenAI, Anthropic, Google or xAI) | search | `packages/core/src/tools/builtin/web-search.ts` |
| `web_fetch` | harness process (raw HTTP) | page reading | `packages/core/src/tools/builtin/web-fetch.ts` |
| `tavily-search`, `tavily-extract`, `tavily-map`, `tavily-crawl` | Tavily API | search, extraction | `integrations/tavily/src/*.ts` |
| `parallel-search`, `parallel-extract` | Parallel API | search, extraction | `integrations/parallel/src/*.ts` |
| `web_search` / `web_extract` (Mastra Code) | Tavily or Parallel, reformatted in harness | search, extraction | `mastracode/sdk/src/tools/web-search.ts` |
| `mastra_workspace_read_file` | harness process | reading large text with offset/limit | `packages/core/src/workspace/tools/read-file.ts` |
| `mastra_workspace_grep` | harness process | in-document search | `packages/core/src/workspace/tools/grep.ts` |
| `mastra_workspace_search`, `mastra_workspace_index` | harness process (BM25 / vector index) | search over saved content | `packages/core/src/workspace/tools/search.ts`, `index-content.ts` |
| `updateWorkingMemory` (`setWorkingMemory`) | harness process + storage | scratchpad / notes | `packages/memory/src/tools/working-memory.ts` |
| `recall` | harness process + storage | re-reading earlier messages and tool results in chunks | `packages/memory/src/tools/om-tools.ts` |
| `task_write`, `task_update`, `task_complete`, `task_check` | harness process | planning | `packages/core/src/tools/builtin/task-tools.ts` |

Briefly listed, not detailed: browser tools in `browser/agent-browser` (`browser_goto`, `browser_snapshot` returning an accessibility tree with `[ref=e1]` handles, `browser_click`, `browser_type`, `browser_scroll`, `browser_evaluate` and so on), Stagehand and Firecrawl browser backends, workspace file editing, shell (`execute_command`), LSP and computer-use tools, `ask_user`, `submit_plan`. Mastra has no think tool, no dedicated final-answer tool (structured output is a model setting), and no time or budget tool.

---

## 1. `webSearchTool` → provider `web_search`

**Where it runs:** on the model provider's servers. `webSearchTool` is only a marker object (`packages/core/src/tools/builtin/web-search.ts:17-19`). When the agent resolves its tools, each marker is swapped for the provider's own hosted search tool, chosen from the model's provider string (`packages/core/src/agent/agent.ts:3066-3074`, `web-search.ts:100-111`):

| Provider | Tool sent | Name the model sees |
|---|---|---|
| openai | `openai.web_search` | `web_search` |
| anthropic | `anthropic.web_search_20250305` | `web_search` |
| google | `google.google_search` | `google_search` |
| xai | `xai.web_search` | `web_search` |

Other providers throw `The built-in webSearchTool supports OpenAI, Anthropic, Google, and xAI models. Could not infer a supported provider from "<provider>".` A router model id like `openai/gpt-5` is matched on the part before the slash (`web-search.ts:95-98`).

**Description and parameters:** Mastra adds none. It sends `args: {}` (`web-search.ts:52-60`), so every provider option (max uses, allowed domains, location) is left at the provider default. What each hosted tool does is covered in `openai_hosted_tools.md`, `anthropic_server_tools.md`, `vercel_provider_tools.md` and `perplexity_xai_hosted_tools.md`.

## 2. `web_fetch`

**Where it runs:** harness process, Node `http`/`https`.

**Description, verbatim** (`packages/core/src/tools/builtin/web-fetch.ts:265`):

```
Fetch a web page by URL and return text content with basic response metadata.
```

**Parameters (model fills in):**

| Name | Type | Required | Description (verbatim) |
|---|---|---|---|
| `url` | string, min length 1 | yes | "The fully qualified HTTP or HTTPS URL to fetch." |

No developer configuration.

**What it does** (`web-fetch.ts:184-253`):
- Blocks `localhost`, private, link-local and reserved IPs, both on the literal host and on every DNS answer (lines 26-159).
- Sends `user-agent: Mastra Web Fetch Tool/1.0` and `accept: text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.8`.
- Follows up to 5 redirects (`MAX_REDIRECTS = 5`, line 12), each re-checked. Timeout 15 seconds (`TIMEOUT_MS = 15_000`, line 13).
- Reads the body and stops at **100,000 characters** (`MAX_CONTENT_LENGTH = 100_000`, line 11), setting `truncated: true`.
- Does **no HTML conversion**. Despite the description saying "text content", the body is returned as-is, so an HTML page arrives as raw HTML with scripts and styles.

**Result shape** (output schema, lines 269-278):

```json
{
  "content": "<!doctype html><html>... first 100,000 characters of the raw body ...",
  "truncated": true,
  "status": 200,
  "statusText": "OK",
  "contentType": "text/html; charset=utf-8",
  "url": "https://example.com/final-url-after-redirects",
  "ok": true
}
```

On error: `{"content": "Failed to fetch URL: <reason>", "isError": true}`, where the reason is for example `Request timed out after 15000ms.`, `Too many redirects. Maximum is 5.` or `URL resolves to a private or reserved address.` Non-2xx responses are not errors; they come back with `ok: false` and the body.

There is no way to read past the first 100,000 characters and no in-page search.

**Prompt rules:** none.

## 3. Tavily tools (`integrations/tavily`)

**Where they run:** Tavily's API (a search API built for LLM agents).

### `tavily-search`

**Description, verbatim** (`integrations/tavily/src/search.ts:67-68`):

```
Search the web using Tavily. Returns relevant results with content snippets, optional AI-generated answers, and images. Supports filtering by domain, time range, and search depth.
```

**Parameters (all filled in by the model; `search.ts:7-30`):**

| Name | Type | Req. | Description (verbatim) |
|---|---|---|---|
| `query` | string | yes | "The search query" |
| `searchDepth` | `basic`\|`advanced`\|`fast`\|`ultra-fast` | no | "Search depth — 'basic' for standard, 'advanced' for thorough, 'fast'/'ultra-fast' for low latency" |
| `maxResults` | number 1-20 | no | "Maximum number of results to return (1-20)" |
| `includeAnswer` | boolean \| `basic`\|`advanced` | no | "Include an AI-generated answer summary. Pass true, \"basic\", or \"advanced\"" |
| `includeImages` | boolean | no | "Include query-related images in the response" |
| `includeImageDescriptions` | boolean | no | "Include descriptions for returned images" |
| `includeRawContent` | false \| `markdown`\|`text` | no | "Include cleaned HTML content of each result. Pass false to disable, or \"markdown\"/\"text\" for format" |
| `includeDomains` | string[] | no | "Restrict results to these domains" |
| `excludeDomains` | string[] | no | "Exclude results from these domains" |
| `timeRange` | `day`\|`week`\|`month`\|`year` | no | "Time range to filter results by recency" |

Developer config: API key (`TAVILY_API_KEY`).

**Result** (`search.ts:86-101`): `{ query, answer?, images?: [{url, description?}], results: [{title, url, content, score, rawContent?}], responseTime }`. `content` is Tavily's query-relevant snippet; `score` is its relevance score. No publish dates.

### `tavily-extract`

**Description, verbatim** (`extract.ts:50-51`):

```
Extract content from one or more URLs using Tavily. Returns raw page content in markdown or text format. Supports up to 20 URLs per request with basic or advanced extraction depth.
```

**Parameters:** `urls` (string[], 1-20, "URLs to extract content from (1-20)"), `extractDepth` (`basic`|`advanced`, "Extraction depth — 'advanced' retrieves more data including tables and embedded content"), `query` (string, "User intent for reranking extracted content chunks. When provided, chunks are reranked based on relevance to this query."), `includeImages` (boolean), `format` (`markdown`|`text`, "Output format for extracted content — 'markdown' (default) or 'text'").

**Result:** `{ results: [{url, rawContent, images?}], failedResults: [{url, error}], responseTime }`. The full page, no length cap on Mastra's side.

### `tavily-map`, `tavily-crawl`

Descriptions, verbatim: "Map a website's structure starting from a URL using Tavily. Discovers and returns a list of URLs found on the site without extracting page content. Useful for understanding site structure before targeted extraction." and "Crawl a website starting from a URL using Tavily. Extracts content from discovered pages with configurable depth, breadth, and domain constraints. Returns structured content from each crawled page."

## 4. Parallel tools (`integrations/parallel`)

**Where they run:** Parallel's Search and Extract APIs (parallel.ai, another search API built for agents).

### `parallel-search`

**Description, verbatim** (`integrations/parallel/src/search.ts`, `createParallelSearchTool`):

```
Search the web with Parallel. Returns ranked URLs and token-efficient excerpts focused on the search objective.
```

**Parameters (model fills in):**

| Name | Type | Req. | Description (verbatim) |
|---|---|---|---|
| `searchQueries` | string[] (min 1) | yes | "Concise keyword search queries, ideally 3-6 words each. Provide 2-3 queries for best results." |
| `objective` | string | no | "A self-contained natural-language description of the goal driving the search." |
| `mode` | `turbo`\|`fast`\|`basic`\|`advanced` | no | "Search mode. Defaults to advanced when omitted." |
| `clientModel` | string | no | "Model that will consume the results, used by Parallel to tailor response defaults." |
| `maxResults` | int | no | "Maximum number of results to return." |
| `excerptMaxCharsPerResult` | int | no | "Maximum excerpt characters to return for each result." |
| `maxCharsTotal` | int | no | "Maximum total excerpt characters across all results." |
| `location` | ISO 3166-1 alpha-2 | no | "ISO 3166-1 alpha-2 country code for geo-targeted results." |
| `includeDomains` / `excludeDomains` | string[] (≤200 combined) | no | "Only return results from these domains." / "Exclude results from these domains." |
| `afterDate` | `YYYY-MM-DD` | no | "Only return content published on or after this YYYY-MM-DD date." |
| `fetchPolicy` | object `{maxAgeSeconds ≥600, timeoutSeconds, disableCacheFallback}` | no | "Live-fetch and cached-content policy for search results." |
| `sessionId` | string | no | "Session identifier shared across related Search and Extract calls." |

**Result:** `{ searchId, sessionId, results: [{url, title?, publishDate?, excerpts: string[]}], usage?, warnings? }`. Distinctive: several queries in one call, an explicit objective, multiple excerpts per result chosen for that objective, and a publish date.

### `parallel-extract`

**Description, verbatim:** "Extract relevant excerpts or full page content from URLs with Parallel. Returns successful results and per-URL errors."

**Parameters:** `urls` (1-20), `objective` ("A natural-language description of the information to focus on while extracting."), `searchQueries` ("Optional keyword queries used with the objective to focus excerpts."), `excerptMaxCharsPerResult`, `clientModel`, `fullContent` (boolean or int: "Return full page content. Pass a character limit instead of true to cap content per URL."), `maxCharsTotal`, `fetchPolicy`, `sessionId`. So the model can ask either for query-focused excerpts of a page or for its full content up to a character limit.

## 5. Mastra Code's `web_search` / `web_extract`

This is how Mastra's own agent uses the tools above (`mastracode/sdk/src/tools/web-search.ts`, wired in `mastracode/sdk/src/agents/tools.ts:161-170`). If a Tavily key is set it uses Tavily; else if a Parallel key is set it uses Parallel; else it falls back to Anthropic's `web_search_20250305` or OpenAI's `web_search` depending on the model.

The descriptions and schemas are passed through unchanged from `tavily-search` / `tavily-extract`, except that Parallel search is reduced to one parameter, `query` ("The search query"), which is sent as `searchQueries: [query]`.

**What changes is the result.** The structured result is flattened into markdown and cut:

```
Answer: <Tavily answer, if requested>

## <title>
<url>
<snippet>

## <title>
...
```

- Tavily results with `score < 0.25` are dropped (`MIN_RELEVANCE_SCORE = 0.25`, line 12).
- Search and extract output are both capped at **~2,000 tokens** (`MAX_WEB_SEARCH_TOKENS`, `MAX_WEB_EXTRACT_TOKENS`, lines 9-10).
- The cap is applied by `truncateStringForTokenEstimate(text, 2000)` with its default `fromEnd = true` (`mastracode/sdk/src/utils/token-estimator.ts:14-23`), which keeps the **last** ~2,000 tokens and prefixes `[Truncated ~N tokens]`. For an extracted page that means the model sees the end of the page (often footer and comments), not the beginning. This looks like an unintended choice, but it is what the code does.

**Prompt rule, verbatim** (`mastracode/sdk/src/agents/prompts/tool-guidance.ts:137-139`):

```
**web_search** / **web_extract** — Search the web / extract page content
- Use for looking up documentation, error messages, package APIs.
```

## 6. `mastra_workspace_read_file`

**Where it runs:** harness process, on the workspace filesystem. Relevant here because it is Mastra's way to read a large saved document piece by piece.

**Description, verbatim** (`packages/core/src/workspace/tools/read-file.ts:100`):

```
Read a file from the workspace filesystem. Text files come back as text — use offset/limit to read a line range from large files. Supported media files come back as a native file part you can view directly. Other binary files return only their metadata (path, size, mime type) since their raw contents are not useful to read.
```

**Parameters (model fills in):**

| Name | Type | Req. | Default | Description (verbatim) |
|---|---|---|---|---|
| `path` | string | yes | | "The path to the file to read (e.g., \"data/config.json\")" |
| `offset` | int ≥1 | no | 1 | "Line number to start reading from (1-indexed). Only used when reading text files; ignored for media and other binary files. Defaults to line 1 if omitted." |
| `limit` | int ≥1 | no | to end | "Maximum number of lines to read. Only used when reading text files; ignored for media and other binary files. Defaults to the end of the file if omitted." |
| `showLineNumbers` | boolean | no | true | "Prefix each line with its line number. Only used when reading text files; ignored for media and other binary files. Defaults to true if omitted." |
| `encoding` | `utf-8`\|`utf8`\|`base64`\|`hex`\|`binary` | no | | "Usually omit this — text files and supported media are handled automatically. Pass `base64` or `hex` to get the file's raw bytes encoded as text when you need to inspect an unsupported binary file that would otherwise only return metadata (e.g. checking a file header or magic bytes)." |

Developer config per tool: `maxOutputTokens`, `mediaTypes` (default PNG, JPEG, WebP, PDF), `maxMediaBytes`.

**What it does:** returns a header plus numbered lines, e.g.

```
docs/report.md (lines 120-180 of 2412, 184533 bytes)
120	The committee met on 4 March...
...
```

Output then passes through `applyTokenLimit(..., 'end')` (`read-file.ts:243`). When `maxOutputTokens` is not configured, the default is **2,000 estimated tokens** (`DEFAULT_MAX_OUTPUT_TOKENS`, `output-helpers.ts:10`), keeping the start and appending `[output truncated: showing first ~2000 of ~N tokens]` (`output-helpers.ts:90-106`). PDFs and images under the size cap are returned as a native file part for the model to view.

## 7. `mastra_workspace_grep`

**Description, verbatim** (`packages/core/src/workspace/tools/grep.ts:45-58`):

```
Search file contents using a regex pattern. Walks the filesystem and returns matching lines with file paths and line numbers.

Usage:
- Basic search: { pattern: "TODO" }
- Regex: { pattern: "function\\s+\\w+\\(" }
- Multiple terms: { pattern: "TODO|FIXME|HACK" }
- Case-insensitive: { pattern: "error", caseSensitive: false }
- Search in directory: { pattern: "import", path: "./src" }
- Filter by glob: { pattern: "import", path: "**/*.ts" }
- Combined path + glob: { pattern: "import", path: "src/**/*.ts" }
- Multiple file types: { pattern: "import", path: "**/*.{ts,tsx,js}" }
- Multiple directories: { pattern: "TODO", path: "{src,lib}/**/*.ts" }
- With context: { pattern: "function", contextLines: 2 }
```

**Parameters:** `pattern` (string, "Regex pattern to search for"), `path` (default `"."`, "File, directory, or glob pattern to search within (default: \".\"). A plain path searches that file or directory. A glob pattern (e.g., \"**/*.ts\", \"src/**/*.test.ts\") filters which files to search."), `contextLines` (default 0), `maxCount` ("Maximum matches per file. Moves on to the next file after this many matches. Similar to grep -m flag."), `caseSensitive` (default true), `includeHidden` (default false). Developer config: `strict` (throw on read errors), `maxOutputTokens`.

**What it does:** JavaScript regex per line. Limits: pattern ≤ 1,000 characters, each matched line cut at 500 characters with `...`, at most 1,000 matches in total (`grep.ts:124,154-155`). Output starts with a summary line, then `path:line:column: text` rows (context lines as `path:line- text`, hunks separated by `--`):

```
3 matches across 1 file
---
notes/page.md:88:14: the unemployment rate fell to 3.9 percent in April
...
```

The whole output is then capped at ~2,000 tokens by default, as for `read_file`.

## 8. `mastra_workspace_search` and `mastra_workspace_index`

**Descriptions, verbatim:** `Search indexed content in the workspace. Supports keyword (BM25), semantic (vector), and hybrid search modes.` and `Index content for search. The path becomes the document ID in search results.`

**Search parameters:** `query` ("The search query string"), `topK` (default 5, "Maximum number of results to return"), `mode` (`bm25`|`vector`|`hybrid`, "Search mode: bm25 for keyword search, vector for semantic search, hybrid for both combined"), `minScore` ("Minimum score threshold (0-1 for normalized scores)").

**Index parameters:** `path` ("The document ID/path for search results"), `content` ("The text content to index"), `metadata` (optional).

**Result** (`search.ts:52-61`): one line per hit, `<id>:<startLine>-<endLine>: <chunk text>`, then `---` and `N results (bm25 search)`. If the requested mode is not configured it silently falls back to one that is. Together these let an agent save pages it fetched and later run keyword or semantic search over them, which is the closest Mastra comes to an "in-page search" over web content.

## 9. `updateWorkingMemory`

**Where it runs:** harness process, writing to Mastra's memory storage. Enabled when the developer turns on working memory. Registered under the name `updateWorkingMemory`, or `setWorkingMemory` when `useStateSignals` is on (`packages/memory/src/tools/working-memory.ts:448-456`).

**Description, verbatim** — one of four variants (`working-memory.ts:177-185`):

- Markdown template (default): `Update the working memory with new information. Any data not included will be overwritten. Always pass data as string to the memory field. Never pass an object.`
- JSON schema: `Update the working memory with new information. Data is merged with existing memory - only include fields you want to add or update. To preserve existing data, omit the field entirely. Arrays are replaced entirely when provided, so pass the complete array or omit it to keep the existing values.`
- With state signals, the description starts with: `The current working memory state is delivered to you each turn by the system inside a <working-memory>...</working-memory> block. That block is system-emitted state, NOT something the user typed — never describe it as the user sharing it. Read from it directly when answering. Only call this tool when the user provides genuinely NEW or CHANGED facts that should be persisted; do NOT call it to re-save unchanged data.`

**Parameters:** `memory` (string: "The Markdown formatted working memory content to store. This MUST be a string. Never pass an object."), or the developer's JSON schema under `memory` for the JSON variant.

**What it does:** Markdown mode replaces the whole memory; it refuses (returns `success: false`, "Attempted to replace existing working memory with empty template. Update skipped to prevent data loss.") if the model sends back the empty template over real data. JSON mode deep-merges: `null` deletes a key, arrays are replaced (`working-memory.ts:23-69`). Returns `{success: true}`.

**Prompt rules, verbatim excerpt** (`packages/memory/src/index.ts:2218-2257`, injected into the system prompt with the current memory):

```
WORKING_MEMORY_SYSTEM_INSTRUCTION:
Store and update any conversation-relevant information by calling the updateWorkingMemory tool. If information might be referenced again - store it!

Guidelines:
1. Store anything that could be useful later in the conversation
2. Update proactively when information changes, no matter how small
...
- This system is here so that you can maintain the conversation when your context window is very short. Update your working memory because you may need it to maintain the conversation without the full conversation history
...
- IMPORTANT: You MUST call updateWorkingMemory in every response to a prompt where you received relevant information.
```

This is a chat-oriented note tool, but the mechanism (a persistent scratchpad that survives when older turns are dropped) is the same thing a research agent would use for running findings.

## 10. `recall`

**Where it runs:** harness process, reading stored messages. It belongs to Mastra's "observational memory", in which older turns are replaced in the prompt by short observations tagged with message-id ranges; `recall` fetches the originals.

**Description, verbatim** (thread scope, `packages/memory/src/tools/om-tools.ts:1228`):

```
Browse conversation history in the current thread. Use mode="messages" (default) to page through messages near a cursor. Use mode="search" to find messages by content in this thread. Use mode="threads" to get the current thread's ID and title.
```

(Resource scope has a longer variant that also browses other threads, line 1227.)

**Parameters (model fills in), verbatim descriptions** (lines 1237-1334), the research-relevant ones:

| Name | Type | Description |
|---|---|---|
| `mode` | `messages`\|`threads`\|`search` | "What to retrieve. \"messages\" (default) pages through message history. ..." |
| `query` | string | "Search query for mode=\"search\". Finds messages semantically similar to this text." |
| `cursor` | string | "A message ID to use as the pagination cursor. ... Extract it from the start or end of an observation group range." |
| `page` | int −50…50 | "Pagination offset. For messages: positive pages move forward from cursor, negative move backward. ..." |
| `limit` | int 1…20 | "Maximum number of items to return per page. Defaults to 20." |
| `detail` | `low`\|`high` | "Detail level for messages. \"low\" (default) returns truncated text and tool names. \"high\" returns full content with tool args/results." |
| `partType` | enum | "Filter results to only include parts of this type. ..." |
| `toolName` | string | "Filter results to only include tool-call and tool-result parts matching this tool name. ..." |
| `partIndex` | int | "Fetch a single part from the cursor message by its positional index. When provided, returns only that part at high detail. Indices are shown as [p0], [p1], etc. in recall results." |
| `charOffset` | int | "Continue reading a truncated single part from this position. Pass the exact nextCharOffset value returned by a previous call; do not compute it yourself. Only applies with cursor and partIndex in mode=\"messages\"." |

**What it does:** low detail shows each part cut to ~100 tokens for text and ~20 for tool calls/results, with an inline hint such as `[recall cursor="msg_123" partIndex=2 detail="high" for more]` (`om-tools.ts:432-525`). A page is capped at ~2,000 tokens (`DEFAULT_MAX_RESULT_TOKENS`). Asking for one part at high detail returns it in ~2,000-token chunks; when more remains, the result carries `nextCharOffset` and a note, verbatim: `To continue this part, call recall cursor="<id>" partIndex=<n> detail="high" charOffset=<offset>.` (`om-tools.ts:863-865`).

This is the one real "keep reading a long document from where you stopped" mechanism in Mastra, and it is built for old tool results (for example a big fetched page) rather than for the web directly.

**Prompt rules, verbatim excerpt** (`packages/memory/src/processors/observational-memory/constants.ts:135-184`):

```
### When to use recall
- The user asks you to **repeat, show, or reproduce** something from a past conversation
- The user asks for **exact content** — code, text, quotes, error messages, URLs, file paths, specific numbers
...
**Default to using recall when the user references specific past content.** Your observations capture the gist, not the details. If there's any doubt whether your memory is complete enough, use recall.
...
**When you see these hints and need the full content, make the exact call described in the hint.** This is the normal workflow: first recall at low detail to scan, then drill into specific parts at high detail. Do not stop at the low-detail result if the user asked for exact content.

If a single part is larger than the token budget, the `partIndex` result is `truncated: true` and includes `nextCharOffset`. Repeat the same call with `charOffset` set to that exact value to read the next chunk from where the previous one ended. Keep following `nextCharOffset` until the result no longer includes it — the chunks together contain the full part. Retrying without `charOffset` returns the same prefix again.
```

## 11. Task-list tools (planning)

`task_write` replaces the whole list; `task_update` and `task_complete` change one task by id; `task_check` reports what is incomplete. `task_write` description, verbatim start (`packages/core/src/tools/builtin/task-tools.ts:424-441`):

```
Create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

Usage:
- Use this to create the initial task list or replace the whole list after replanning
- Pass the FULL task list each time this tool is called (replaces the previous list)
...
- Mark tasks in_progress BEFORE starting work (only ONE at a time)
- Mark tasks completed IMMEDIATELY after finishing
- Use this for multi-step tasks requiring 3+ distinct actions
```

Each task is `{id, content, status: pending|in_progress|completed, activeForm}`. `task_check` returns counts and `allCompleted`, and its description says "Use this before finishing tracked work to ensure all tasks are completed."

---

## What stands out for web research

- The built-in `web_fetch` is the rawest fetcher studied: raw HTML up to 100,000 characters, no conversion to text or markdown, even though its description promises "text content".
- The built-in `webSearchTool` is only a switch that turns on whichever provider-hosted search matches the model, with no options.
- The best-designed search shapes come from the integrations. Parallel takes several short queries plus a natural-language objective and returns objective-focused excerpts with publish dates. Tavily and Parallel extract can both focus a page on a query or objective instead of returning it whole.
- Mastra Code's wrappers cap search and page output at about 2,000 tokens and keep the end of the text rather than the start, so a long page is read from its footer.
- The most careful long-content reading design is `recall`: scan at low detail, open one part at high detail, and follow an explicit `nextCharOffset` to continue. The same design could serve a page-reading tool.
- No citation mechanism, no final-answer tool, no budget or time awareness in any of these tools.
