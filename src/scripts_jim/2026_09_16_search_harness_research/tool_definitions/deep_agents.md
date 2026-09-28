# LangChain Deep Agents (Python `deepagents` and JS `deepagents`): tool definitions

Sources: `sdks/langchain-ai_deepagents` (commit 229ffef, 2026-09-16) and `sdks/langchain-ai_deepagentsjs` (commit 280f573, 2026-09-16). The `write_todos` tool lives in LangChain itself: `sdks/langchain-ai_langchain/libs/langchain_v1/langchain/agents/middleware/todo.py`.
Python paths below are relative to `langchain-ai_deepagents/libs/deepagents/deepagents/`; JS paths to `langchain-ai_deepagentsjs/libs/deepagents/src/`.

"Deep Agents" is LangChain's harness built on LangGraph. It ships **no web tools at all**. The developer supplies search (the examples use Tavily). What Deep Agents contributes to web research is the machinery around the tools: a virtual filesystem the agent can read and grep, **automatic offloading of any large tool result into that filesystem**, sub-agents through a `task` tool, and (opt-in) a `write_todos` planning tool. Everything runs in the harness process; the filesystem is by default an in-memory dict kept in the LangGraph state (`StateBackend`), but can be a real disk, a sandbox, or a store.

Terminology from the codebase: a **middleware** is a LangChain plug-in object that can add tools, append text to the system prompt, and wrap every model call and tool call. Each Deep Agents feature is one middleware.

## Index

| Tool | Added by | Runs in | Research relevance |
|---|---|---|---|
| `read_file` | `FilesystemMiddleware` (`middleware/filesystem.py:1965`) | harness | reads offloaded large tool results page by page with `offset`/`limit` (lines) |
| `grep` | `FilesystemMiddleware` (`filesystem.py:2607`) | harness | literal-string search across files, including offloaded results |
| `ls`, `glob` | `FilesystemMiddleware` | harness | find files, including `/large_tool_results/` |
| `write_file`, `edit_file`, `delete` | `FilesystemMiddleware` | harness | scratch notes, final report file (brief) |
| `execute` | `FilesystemMiddleware`, only with a sandbox backend | sandbox | shell (brief) |
| `task` | `SubAgentMiddleware` (`middleware/subagents.py:577`) | **nested agent run** | delegate a research question to a fresh-context sub-agent |
| `compact_conversation` | `SummarizationToolMiddleware` (opt-in) | nested LLM call | summarize older messages on demand |
| `write_todos` | LangChain `TodoListMiddleware` (**opt-in since 0.7**) | harness | planning checklist in state |
| (not a tool) large-result eviction | `FilesystemMiddleware.wrap_tool_call` (`filesystem.py:3605`) | harness | replaces any tool result over 80,000 characters with a file path plus 10-line preview |
| `tavily_search`, `think_tool` | the `examples/deep_research` app, not the library | harness | the reference research agent's two tools |
| `internet_search` | the JS `examples/research` app | harness | Tavily wrapper |

Two recent changes matter when reading older blog posts about Deep Agents. First, `write_todos` is **no longer in the default stack** in either language: the JS test `agent.test.ts:460` asserts `"does not include todos by default"`, and in Python only the OpenAI Codex harness profile adds it (`profiles/harness/_openai_codex.py:77`). Second, Deep Agents **no longer ships a base system prompt**: `graph.py:124-138` keeps the old text only as a deprecated constant (`"Deep Agents no longer provides an authored base prompt."`), and the filesystem middleware adds no tool-usage prose of its own (`filesystem.py:3180-3185`: "no built-in tool-usage guidance is generated, since it would duplicate the tools' own schema descriptions"). So nearly all guidance now lives in the tool descriptions quoted below.

---

## Large tool result eviction (the core research-relevant mechanism)

This is not a tool the model calls, but it decides what the model sees from every search or fetch tool.

- **Where:** `FilesystemMiddleware.wrap_tool_call` (`filesystem.py:3605-3654`) calls `_process_large_message` (`filesystem.py:3282-3325`), which calls `_offload_tool_message_content` (`middleware/_message_eviction.py:120-137`). JS: `middleware/fs.ts:2054-2090`.
- **Threshold:** `tool_token_limit_before_evict=20000` tokens (`filesystem.py:1754`), converted to characters with `NUM_CHARS_PER_TOKEN = 4`, so any tool result longer than **80,000 characters** is evicted. Same numbers in JS (`fs.ts:127`, `fs.ts:1959`). Developers can change or disable it (`None`).
- **Exempt tools:** `ls`, `glob`, `grep`, `read_file`, `edit_file`, `write_file`, `delete` (`TOOLS_EXCLUDED_FROM_EVICTION`, `filesystem.py:1611`). Every other tool, including any web search or fetch tool the developer adds, is subject to eviction.
- **What happens:** the full text is written to `/large_tool_results/{tool_call_id}` in the agent's filesystem, and the tool message is replaced by this text (Python `_message_eviction.py:26-35`, verbatim):
  ```
  Tool result too large, the result of this tool call {tool_call_id} was saved in the filesystem at this path: {file_path}

  You can read the result from the filesystem by using the read_file tool, but make sure to only read part of the result at a time.

  You can do this by specifying an offset and limit in the read_file tool call. For example, to read the first 100 lines, you can use the read_file tool with offset=0 and limit=100.

  Here is a preview showing the head and tail of the result (lines of the form `... [N lines truncated] ...` indicate omitted lines in the middle of the content):

  {content_sample}
  ```
  The preview (`_create_content_preview`, `_message_eviction.py:38-62`) is the first 5 and last 5 lines, each cut to 1,000 characters, with line numbers:
  ```
       1  # Page title
       2  Some intro paragraph...
       3
       4  ## Section
       5  First paragraph of section...
  ... [812 lines truncated] ...
     818  Footer link
     ...
  ```
  The JS template (`fs.ts:373-386`) has the same wording except the example line limit is interpolated from `DEFAULT_READ_LINE_LIMIT` (100).
- **Human messages** over `human_message_token_limit_before_evict=50000` tokens (200,000 characters) are offloaded the same way with `TOO_LARGE_HUMAN_MSG` (`filesystem.py:1622`).

The design point: nothing is ever silently cut. A long page arrives as a pointer plus a preview, and the model decides whether to page through it with `read_file` or search it with `grep`. Compare our `web_fetch`, which drops everything after 20,000 characters.

---

## `read_file`

- **Runs in:** harness, against the configured backend.
- **Description, verbatim** (Python `filesystem.py:1353-1377`, text-only variant; the video variant differs only in the first bullet and adds a video bullet):
  ```
  Reads a file from the filesystem. Assume any path the user provides is valid; reading a missing file returns an error.

  Usage:
  - By default, it reads up to 100 lines starting from the beginning of the file. Use `offset`/`limit` to page through large files instead of reading them whole.
  - A status header, `@@ field | field | ... @@`, sits above the file content, and every line after it is verbatim file content. When content is truncated, there may be an explanation before the header. Never include the header when editing.
  - Speculatively batch multiple `read_file` calls in one response when several files may be useful.
  - An empty file returns a system-reminder warning in place of contents.
  - Large tool results may be offloaded to a file; the tool message gives the path. Read that path here, paging with `offset`/`limit`.
  - Images (`.png`, `.jpg`, etc.), audio, video, and PDFs return multimodal content blocks (https://docs.langchain.com/oss/python/langchain/messages#multimodal).
  - For images and PDFs, pagination via `offset`/`limit` is text-only - supply `file_path` only
  - Always read a file before editing it.
  ```
  JS (`fs.ts:1007-1019`) is the same except it says "unmodified file content" instead of "verbatim file content" and links the JS docs.
- **Parameters** (`ReadFileSchema`, `filesystem.py:1232-1245`):
  | name | type | required | default | description |
  |---|---|---|---|---|
  | `file_path` | string | yes | | `Absolute path to the file to read. Must be absolute, not relative.` |
  | `offset` | integer | no | 0 | `Line number to start reading from (0-indexed). Use for pagination of large files.` |
  | `limit` | integer | no | 100 | `Maximum number of lines to read. Use for pagination of large files.` |
- **What it does (`filesystem.py:1965-2140`):** reads the requested line window and returns a one-line status header followed by the raw lines (no line-number gutter any more; `_format_source_block`, `backends/utils.py:262`). Example:
  ```
  @@ lines 101-200 of 823 | next offset 200 @@
  <100 verbatim lines>
  ```
  The header is built by `_window_fields` / `_read_header` (`filesystem.py:803-874`). If the window is still longer than 80,000 characters, the body is cut at the last whole line that fits and the header's `next offset` is rewritten to point at the first unshown line (`_truncate_paginated_read`, `filesystem.py:1028`), followed by (`READ_FILE_TRUNCATION_MSG`, `filesystem.py:976`):
  ```
  [Output was truncated due to size limits. The file content is very large. Consider reformatting the file to make it easier to navigate. For example, if this is JSON, use execute(command='jq . {file_path}') to pretty-print it with line breaks. For other formats, you can use appropriate formatting tools to split long lines.]
  ```
  Other model-visible notices: `System reminder: File exists but has empty contents`; `System reminder: no lines were read because `limit` was {limit}. ...`; `[Requested offset {offset} is before the start of the file; read from line 1 instead.]`.
  Pagination is by **lines**, not characters. For a web page converted to markdown, where a paragraph is one line, 100 lines can be anything from a few hundred characters to the whole 80,000-character cap.

## `grep`

- **Description, verbatim** (Python `filesystem.py:1424-1430`, shown with the execute fallback line that appears only when a shell is available):
  ```
  Search for a LITERAL text pattern across files (NOT regex).

  The pattern is matched verbatim: regex metacharacters are ordinary characters, not operators. To match any of several strings, run a separate grep for each; `grep(pattern="foo|bar")` searches for the literal text "foo|bar", and `.*` or `\.` match those characters literally.
  - If you genuinely need regex, use the execute tool with `rg '<regex>'` instead.

  Returns matching files or content per `output_mode`. Offloaded large tool results live under the artifacts root (`/large_tool_results/` by default); grep that directory to search them when you do not know the exact path.
  ```
- **Parameters** (`GrepSchema`, `filesystem.py:1312-1334`):
  | name | type | required | default | description |
  |---|---|---|---|---|
  | `pattern` | string | yes | | `Text pattern to search for (literal string, not regex).` |
  | `path` | string or null | no | null | `Directory to search in. Defaults to current working directory.` |
  | `glob` | string or null | no | null | `Glob pattern (NOT regex) limiting which files are searched (e.g. '*.py', '*.ts'). A pattern without '/' matches the file name at any depth; a pattern containing '/' matches the search-root-relative path (e.g. 'src/**/*.py'). This is an in-tool file filter, not a call to the separate glob tool. Brace expansion (e.g. '*.{ts,tsx}') is not supported on all backends; run a separate search per extension for reliable results.` |
  | `output_mode` | `"files_with_matches"` \| `"content"` \| `"count"` | no | `files_with_matches` | `Shape of the returned text. 'files_with_matches' (default): newline-separated matching file paths. 'content': matching lines grouped by file under a '<path>:' header, each line indented and formatted '<line_number>: <line text>' (only the matched line, no surrounding context). 'count': one '<path>: <match_count>' line per file.` |
  | `max_count` | integer > 0 or null | no | null (developer default 1000) | `Optional cap on the total number of matches returned across all files. Leave unset to use the configured default. When the cap is hit, results are truncated and a note says so; narrow the pattern or path to see the rest.` |
  JS differences (`fs.ts:1705-1740`): `path` defaults to `"/"`, **`output_mode` defaults to `"content"`**, and the descriptions are shorter (`Literal text pattern to search for (not regex)`, `Output format: 'files_with_matches' lists matching file paths, 'content' shows matching lines (default), 'count' shows match counts per file`).
- **What it does:** literal substring match. In `content` mode it returns (`backends/utils.py:905-931`):
  ```
  /large_tool_results/call_abc123:
    57: The unemployment rate fell to 3.9 percent in March.
    212: ... revised the rate to 3.9 percent ...
  ```
  Only the matching line, never neighbouring lines. On a markdown web page a "line" is usually a whole paragraph, so in practice the match comes with its paragraph. Stops at 1,000 matches or a time limit and says so (`GREP_TRUNCATION_NOTE`, `filesystem.py:932`): `Note: the search stopped early (it hit its time limit or the maximum match count). The matches above are valid but incomplete. ...` No match returns `No matches found`.
  With `read_file` this gives the "find inside a large page" workflow: grep the offloaded result for a phrase, get the line number, then `read_file` with `offset` near that line.

## `ls` and `glob` (brief)

- `ls` description (`filesystem.py:1348`): `Lists all files in a directory.\n\nThis is useful for exploring the filesystem and finding the right file to read or edit.\nYou should almost ALWAYS use this tool before using the read_file or edit_file tools.` Parameter `path` (`Absolute path to the directory to list. Must be absolute, not relative.`).
- `glob` description (`filesystem.py:1412-1420`) explains `*`, `**`, `?`, `[abc]`, `{a,b}` and dot-file rules; parameters `pattern` and optional `path`; 10-second timeout (`GLOB_TIMEOUT`).

## `write_file`, `edit_file`, `delete`, `execute` (brief)

Standard file tools (descriptions at `filesystem.py:1387-1410`, `1439-1449`). In research agents `write_file` is how notes and the final report are kept outside the context window (the deep-research example writes `/research_request.md` and `/final_report.md`). `execute` exists only when the backend is a sandbox; its description tells the model to prefer the `grep`/`glob`/`read_file` tools over shell `grep`/`find`/`cat`.

---

## `task` (sub-agent)

- **Runs in:** a **nested agent run** (a separate LangGraph graph with its own message history), started from the harness.
- **Description, verbatim** (Python `middleware/subagents.py:426-440`; JS `middleware/subagents.ts:112-127` is identical):
  ```
  Launch an ephemeral subagent to handle a complex, multi-step task.

  Available agent types and the tools they have access to:
  {available_agents}

  Specify subagent_type to select the agent. Usage notes:
  - Launch multiple agents concurrently when their tasks are independent, using a single message with multiple tool calls.
  - Each invocation is stateless by default: the agent sees only the prompt you give it and returns a single final report. Put full detail in the prompt and state exactly what it should return — unless an agent type below says it inherits your conversation instead.
  - The agent's report is not shown to the user; relay a summary yourself.
  - Tell the agent whether to create content, analyze, or only research, since it can't necessarily see the user's intent unless it inherits your conversation, as noted per agent type below.
  - If an agent's description says to use it proactively, do so without waiting to be asked.
  - When only general-purpose is available, use it for any complex, context-heavy task; it has the same capabilities as the main agent.
  ```
  `{available_agents}` is one line per sub-agent, `- {name}: {description}`. The built-in one is (`subagents.py:454`):
  ```
  - general-purpose: General-purpose agent for researching complex questions, searching for files and content, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. This agent has access to all tools as the main agent.
  ```
  A sub-agent configured as a fork gets the suffix ` (inherits your full conversation and system prompt — no need to restate context here)`.
- **Parameters** (`TaskToolSchema`, `subagents.py:413-424`):
  | name | type | required | description |
  |---|---|---|---|
  | `description` | string | yes | `A detailed description of the task for the subagent to perform autonomously. Include all necessary context and specify the expected output format.` |
  | `subagent_type` | string | yes | `The type of subagent to use. Must be one of the available agent types listed in the tool description.` |
- **What it does (`subagents.py:577-780`):** runs the sub-agent with only `description` as its user message (unless it is a fork), then returns the text of the sub-agent's **last non-empty AI message** as the tool result (`_return_command_with_state_update`, `subagents.py:677-710`), or its structured response as JSON if it has one. The sub-agent's todos and messages do not flow back; its filesystem writes do (files are shared state). The default sub-agent system prompt (Python `subagents.py:387-390`):
  ```
  In order to complete the objective that the user asks of you, you have access to a number of standard tools.

  The calling agent only sees your final assistant message, not your intermediate work, tool results, or status tracking. Ensure your final
  response contains the complete answer.
  ```
  (JS keeps only the first sentence.) A forked sub-agent that tries to call `task` again is refused with `You are a subagent and cannot delegate to another subagent. Complete this task yourself instead of calling this tool again.` In JS, per-agent call-count limits (from LangChain's `modelCallLimitMiddleware` / `toolCallLimitMiddleware`) are deliberately not shared between parent and sub-agent (`subagents.ts:50-69`), so each agent has its own budget.

## `write_todos` (opt-in)

- **Runs in:** harness. Stores the list in graph state; no side effect beyond that.
- **Description, verbatim** (`langchain_v1/langchain/agents/middleware/todo.py:52-117`):
  ```
  Use this tool to create and manage a structured task list for your current work session. This helps you track progress and organize complex tasks.

  Only use this tool if you think it will be helpful in staying organized. If the user's request is trivial and takes less than 3 steps, it is better to NOT use this tool and just do the task directly.

  ## When to Use This Tool

  Use this tool in these scenarios:

  1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
  2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
  3. User explicitly requests todo list - When the user directly asks you to use the todo list
  4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
  5. The plan may need future revisions or updates based on results from the first few steps

  ## How to Use This Tool

  1. When you start working on a task - Mark it as in_progress BEFORE beginning work.
  2. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation.
  3. You can also update future tasks, such as deleting them if they are no longer necessary, or adding new tasks that are necessary. Don't change previously completed tasks.
  4. You can make several updates to the todo list at once. For example, when you complete a task, you can mark the next task you need to start as in_progress.

  ## When NOT to Use This Tool

  It is important to skip using this tool when:
  1. There is only a single, straightforward task
  2. The task is trivial and tracking it provides no benefit
  3. The task can be completed in less than 3 trivial steps
  4. The task is purely conversational or informational

  ## Task States and Management

  1. **Task States**: Use these states to track progress:
      - pending: Task not yet started
      - in_progress: Currently working on (you can have multiple tasks in_progress at a time if they are not related to each other and can be run in parallel)
      - completed: Task finished successfully

  2. **Task Management**:
      - Update task status in real-time as you work
      - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
      - Complete current tasks before starting new ones
      - Remove tasks that are no longer relevant from the list entirely
      - IMPORTANT: When you write this todo list, you should mark your first task (or tasks) as in_progress immediately!.
      - IMPORTANT: Unless all tasks are completed, you should always have at least one task in_progress.

  3. **Task Completion Requirements**:
      - ONLY mark a task as completed when you have FULLY accomplished it
      - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
      - When blocked, create a new task describing what needs to be resolved
      - Never mark a task as completed if:
          - There are unresolved issues or errors
          - Work is partial or incomplete
          - You encountered blockers that prevent completion
          - You couldn't find necessary resources or dependencies
          - Quality standards haven't been met

  4. **Task Breakdown**:
      - Create specific, actionable items
      - Break complex tasks into smaller, manageable steps
      - Use clear, descriptive task names

  Being proactive with task management ensures you complete all requirements successfully
  Remember: If you only need to make a few tool calls to complete a task, and it is clear what you need to do, it is better to just do the task directly and NOT call this tool at all.

  ## When You Finish

  `write_todos` tracks your work; it does not deliver the answer. Whatever the user asked for — computations, summaries, comparisons, data — must appear as text content in a message after your final `write_todos` call. Marking the last todo complete is not itself an answer to the user.
  ```
- **Parameters:** `todos`: array of `{content: string, status: "pending" | "in_progress" | "completed"}`, required.
- **What it does (`todo.py:139-170`, parallel-call check at `todo.py:289-325`):** replaces the whole list in state and returns `Updated todo list to [{'content': ..., 'status': ...}, ...]`. The middleware rejects parallel `write_todos` calls in one turn.
- **Prompt rules** (`WRITE_TODOS_SYSTEM_PROMPT`, `todo.py:119-137`), appended to the system prompt, verbatim:
  ```
  ## `write_todos`

  You have access to the `write_todos` tool to help you manage and plan complex objectives.
  Use this tool for complex objectives to ensure that you are tracking each necessary step.
  This tool is very helpful for planning complex objectives, and for breaking down these larger complex objectives into smaller steps.

  It is critical that you mark todos as completed as soon as you are done with a step. Do not batch up multiple steps before marking them as completed.
  For simple objectives that only require a few steps, it is better to just complete the objective directly and NOT use this tool.
  Writing todos takes time and tokens, use it when it is helpful for managing complex many-step problems! But not for simple few-step requests.

  ## Important To-Do List Usage Notes to Remember

  - The `write_todos` tool should never be called multiple times in parallel.
  - Don't be afraid to revise the To-Do list as you go. New information may reveal new tasks that need to be done, or old tasks that are irrelevant.

  ## Finishing a task

  When you finish all work, write your final answer in the message AFTER your last `write_todos` call — not in the same turn as that call. Start the final message with the substantive content the user asked for — the data, computation, summary, or analysis. The user wants the result, not confirmation that the work is done.
  ```

## `compact_conversation` (opt-in)

Description, verbatim (`middleware/summarization.py:2009-2016`): `Compact the conversation by summarizing older messages into a concise summary. Use this proactively when the conversation is getting long to free up context window space. Use it when moving on to a completely new, unrelated task, or after finishing synthesis or extraction when the previous working context is no longer needed. This tool takes no arguments.` It runs a nested summarization call. Separately, the automatic `SummarizationMiddleware` in the default stack compacts the history when it reaches 85% of the model's context window and keeps the most recent 10% (`summarization.py:34-35`).

## There is no final-answer tool

The run ends when the model replies without a tool call. The sub-agent's answer is its last AI message text.

---

## The reference research agent (`examples/deep_research/`, Python)

This is LangChain's own "deep research" example built on Deep Agents. Its tools are in `research_agent/tools.py`, its prompts in `research_agent/prompts.py`; `agent.py` sets `max_concurrent_research_units = 3` and `max_researcher_iterations = 3`.

### `tavily_search`

- **Description as the model sees it** (LangChain builds it from the docstring with `parse_docstring=True`, so the `Args:` and `Returns:` sections become parameter descriptions and are dropped from the text):
  ```
  Search the web for information on a given query.

  Uses Tavily to discover relevant URLs, then fetches and returns full webpage content as markdown.
  ```
- **Parameters:** the model fills only `query` (`Search query to execute`). `max_results` (default **1**) and `topic` (default `general`) are marked `InjectedToolArg`, which hides them from the model; only the developer can set them.
- **What it does (`tools.py:38-88`):** calls Tavily search for URLs, then fetches **each result page itself** with `httpx` (10-second timeout, desktop Chrome User-Agent) and converts the full HTML with `markdownify`, with no length cap. Returns:
  ```
  🔍 Found 1 result(s) for '{query}':

  ## {title}
  **URL:** {url}

  {entire page as markdown}

  ---
  ```
  So search and fetch are fused into one call that returns one full page. A long page is not cut by the tool; it is caught by the 80,000-character eviction rule above and turned into a file the model must page through.

### `think_tool`

- **Description as the model sees it** (docstring minus Args/Returns):
  ```
  Tool for strategic reflection on research progress and decision-making.

  Use this tool after each search to analyze results and plan next steps systematically.
  This creates a deliberate pause in the research workflow for quality decision-making.

  When to use:
  - After receiving search results: What key information did I find?
  - Before deciding next steps: Do I have enough to answer comprehensively?
  - When assessing research gaps: What specific information am I still missing?
  - Before concluding research: Can I provide a complete answer now?

  Reflection should address:
  1. Analysis of current findings - What concrete information have I gathered?
  2. Gap assessment - What crucial information is still missing?
  3. Quality evaluation - Do I have sufficient evidence/examples for a good answer?
  4. Strategic decision - Should I continue searching or provide my answer?
  ```
- **Parameters:** `reflection` (string, required, `Your detailed reflection on research progress, findings, gaps, and next steps`).
- **What it does:** nothing; returns `Reflection recorded: {reflection}`. It is a scratchpad that forces a reasoning turn between searches.

### Prompt rules that govern these tools (`research_agent/prompts.py`), verbatim excerpts

Researcher sub-agent (`RESEARCHER_INSTRUCTIONS`), including the only budget rules in Deep Agents:
```
You are a research assistant conducting research on the user's input topic. For context, today's date is {date}.
...
<Available Research Tools>
You have access to two specific research tools:
1. **tavily_search**: For conducting web searches to gather information
2. **think_tool**: For reflection and strategic planning during research
**CRITICAL: Use think_tool after each search to reflect on results and plan next steps**
</Available Research Tools>

<Instructions>
Think like a human researcher with limited time. Follow these steps:

1. **Read the question carefully** - What specific information does the user need?
2. **Start with broader searches** - Use broad, comprehensive queries first
3. **After each search, pause and assess** - Do I have enough to answer? What's still missing?
4. **Execute narrower searches as you gather information** - Fill in the gaps
5. **Stop when you can answer confidently** - Don't keep searching for perfection
</Instructions>

<Hard Limits>
**Tool Call Budgets** (Prevent excessive searching):
- **Simple queries**: Use 2-3 search tool calls maximum
- **Complex queries**: Use up to 5 search tool calls maximum
- **Always stop**: After 5 search tool calls if you cannot find the right sources

**Stop Immediately When**:
- You can answer the user's question comprehensively
- You have 3+ relevant examples/sources for the question
- Your last 2 searches returned similar information
</Hard Limits>

<Show Your Thinking>
After each search tool call, use think_tool to analyze the results:
- What key information did I find?
- What's missing?
- Do I have enough to answer the question comprehensively?
- Should I search more or provide my answer?
</Show Your Thinking>

<Final Response Format>
When providing your findings back to the orchestrator:

1. **Structure your response**: Organize findings with clear headings and detailed explanations
2. **Cite sources inline**: Use [1], [2], [3] format when referencing information from your searches
3. **Include Sources section**: End with ### Sources listing each numbered source with title and URL
...
The orchestrator will consolidate citations from all sub-agents into the final report.
</Final Response Format>
```
Orchestrator (`RESEARCH_WORKFLOW_INSTRUCTIONS`, citation part):
```
**Citation format:**
- Cite sources inline using [1], [2], [3] format
- Assign each unique URL a single citation number across ALL sub-agent findings
- End report with ### Sources section listing each numbered source
- Number sources sequentially without gaps (1,2,3,4...)
- Format: [1] Source Title: URL (each on separate line for proper list rendering)
```
and (`SUBAGENT_DELEGATION_INSTRUCTIONS`):
```
## Research Limits
- Stop after {max_researcher_iterations} delegation rounds if you haven't found adequate sources
- Stop when you have sufficient information to answer comprehensively
- Bias towards focused research over exhaustive exploration
```
The budgets are prompt text only; nothing counts the calls.

### JS example (`examples/research/research-agent.ts`)

One tool, `internet_search`, description `Run a web search`, parameters `query` (`The search query`), `maxResults` (default 5, `Maximum number of results to return`), `topic` (`general` | `news` | `finance`, `Search topic category`), `includeRawContent` (default false, `Whether to include raw content`). It returns the raw Tavily response object. Here the model, not the developer, chooses the result count and whether to pull full page text. The report prompt ends with citation rules including `Citations are extremely important. Make sure to include these, and pay a lot of attention to getting these right. Users will often use these citations to look into more information.`

## What is distinctive

- **Search result shape:** not defined by the library. The Python example fuses search and fetch and returns one full page per query (`max_results=1`, hidden from the model).
- **Page reading:** nothing is truncated by the tool; anything over 80,000 characters is moved to a file and replaced with a path plus a 5-line head and 5-line tail. The model then pages by line with `read_file` (100 lines default, 80,000-character cap per read, with a header saying `lines X-Y of N | next offset Z`).
- **In-page search:** `grep` on the offloaded file, literal strings only, returns matching lines with line numbers (a markdown paragraph is usually one line). The grep description itself points the model at `/large_tool_results/`.
- **Citations:** prompt-only, numbered `[1]` with a `### Sources` list; no quote extraction or verification.
- **Final answer:** no tool; the last message text is the answer, and for sub-agents it is the only thing returned.
- **Budget:** the example's prompt sets search-call budgets ("2-3", "up to 5") and stop conditions, but nothing enforces or reports them. The library itself has no budget or time signal apart from the date in the example prompt and automatic compaction at 85% of context.
- **Surprises:** `write_todos` and the authored base prompt, both hallmarks of the original Deep Agents design, have been removed from the defaults; and the Python and JS `grep` tools disagree on their default `output_mode`.
