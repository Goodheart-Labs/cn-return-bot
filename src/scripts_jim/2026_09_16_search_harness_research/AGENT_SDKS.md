# How agent SDKs work inside, and how they differ from our tool loop

Research for GOO-166, written 2026-09-17. Jim asked how the agent SDKs work internally, how they differ from ours, and which tools the model gets. Six readers each took one family of systems and read the source code where it exists: cloned GitHub repositories, unpacked npm packages, and for Claude Code the JavaScript carved out of the compiled binary. For closed systems they read the official docs and, where marked, leaked system prompts. Line numbers refer to the commits named in section 9.

Our own loop is `src/pipeline/tool-calling/toolLoop.ts`, 147 lines. Everything below is compared against it.

## Summary

Every agent SDK runs the same loop. The model is called with a list of tools. If it asks for tools, the harness runs them, appends the results to the conversation, and calls the model again. If it answers without a tool call, the run ends. That is exactly what our 147 lines do. No SDK has a smarter loop in the sense of planning, search strategy or reasoning. The differences are all in the machinery around the loop, and in the tools.

What the SDKs have that we lack, ordered by how much it matters for a cheap model checking facts:

1. **Tool errors go back to the model.** Every system turns an unknown tool name, malformed arguments, or a crashing tool into a tool result the model can read and react to. Ours does not: if a model sends arguments that are not valid JSON, `JSON.parse` in `toolLoop.ts` throws and the whole claim check dies.
2. **Tool calls in one turn run at the same time.** Almost every system runs them in parallel. We run them one after another, which is where the 2,605-fetch runaway run spent its time.
3. **Big tool outputs are handled explicitly.** Nobody silently keeps the first N characters the way our `web_fetch` does. The options are: keep the start and the end and say how much was cut (Codex), move the output to a file and show a preview the model can page through (Claude Code, Deep Agents, OpenHands), or let a small model read the page and answer a question about it (Claude Code, Gemini CLI, xAI, Strands).
4. **Repeated calls are noticed.** Gemini CLI, OpenHands and the OpenRouter Agent SDK detect the same call repeating and first warn the model, then stop.
5. **The final answer is validated.** Several systems make the answer a tool whose arguments are the output schema, check it, and send validation errors back for another try. We parse whatever comes back and fail if it is wrong.

What we have that most of them lack: **a forced final answer when the turn budget runs out.** Our loop makes one last call without tools that says "Stop searching. Return your final answer as JSON now." The hosted loops (Perplexity, xAI, OpenRouter's server tools, Microsoft Agent Framework), the OpenRouter Agent SDK, smolagents and Gemini CLI's subagents do the same. OpenAI's Agents SDK, Vercel's AI SDK, LangChain, Pydantic AI, Google ADK and OpenHands instead raise an error or end with no answer. For a cheap model that often uses up its budget, this decides whether a claim gets a verdict at all. Keep it.

On tools: the systems built for coding (Claude Code, Codex, Gemini CLI, OpenHands) give the model a shell, file tools, a to-do list and subagents. The systems built for research give it search and page reading. The most interesting finding is how differently they let the model read the web, which section 6 lays out.

## 1. Vocabulary

These terms recur. Where a term belongs to one vendor, it says so.

- **Agent loop, or tool loop.** The cycle described in the summary. Each SDK calls one pass something different: a *turn* (OpenAI Agents SDK, ours), a *step* (Vercel AI SDK, smolagents, Perplexity), an *iteration* (Microsoft, OpenHands). Codex uses "turn" for a whole user request containing many model calls. This document says **turn** for one model call plus the tool calls that follow it.
- **Tool call.** A structured request the model emits instead of text: a tool name plus JSON arguments. In the OpenAI-compatible chat completions format we use, it arrives as `tool_calls` on the assistant message, and the result goes back as a message with `role: "tool"`.
- **Client-side tool.** A tool that runs in the harness's own process, such as our `google_search`. The model only asks for it.
- **Server tool, or hosted tool.** A tool that runs on the model provider's servers inside a single API request, such as Anthropic's `web_search` or OpenAI's `web_search`. The provider runs its own mini loop and returns the model's final text plus a record of what it did. The caller often does not get to see the raw results.
- **Parallel tool calls.** A model may ask for several tools in one turn. "Parallel" here means the harness runs them at the same time rather than one after another. Providers also have a request flag with the same name that only controls whether the model may *ask* for several at once.
- **`tool_choice`.** An OpenAI-format request field: `auto` lets the model decide, `required` forces some tool call, `none` forbids tool calls, and a named tool forces that tool.
- **Structured output.** A final answer that must match a JSON schema. Either the provider constrains decoding (`response_format` with `json_schema`), or the harness exposes a "final answer" tool whose arguments are the schema.
- **Compaction.** Replacing older parts of the conversation with a model-written summary when the context window fills up. **Context editing** is the cheaper cousin: replacing old tool results with a placeholder.
- **Context window.** The maximum number of tokens a model can read in one request. Every turn resends the whole conversation, so tool results are billed again on every later turn.
- **Hooks, or middleware, or callbacks.** Functions the SDK calls before and after each model call or tool call, to log, change or block it.
- **Handoff.** An OpenAI Agents SDK term: the current agent passes control of the conversation to another agent, shown to the model as a tool named `transfer_to_<agent>`.
- **Subagent.** A separate agent run with its own fresh conversation, started through a tool call. Only its final report comes back to the caller.
- **MCP, the Model Context Protocol.** A standard, originally from Anthropic, for running tools in a separate server process and exposing them to any agent.

## 2. The loop, and our loop

This is the loop every system runs, in pseudocode:

```
messages = [system prompt, user message]
repeat:
    reply = model(messages, tools)
    if reply has no tool calls: return reply
    append reply to messages
    results = run each requested tool
    append results to messages
```

Our `runToolLoop` adds three things to that skeleton:

- **Turn 1 forces a tool call.** It sends `tool_choice: "required"`, because some models otherwise answer straight from the JSON schema without searching. If the provider refuses `required` (Meta does, so Muse always hits this), it retries with `auto`.
- **Structured output on free turns.** Every turn that does not force a tool call also carries `response_format`, so the answer can arrive as JSON directly.
- **A forced final answer at the cap.** After `maxTurns`, it appends "Stop searching. Return your final answer as JSON now." and makes one call without tools.

What it does not do, each of which some SDK does:

| Missing piece | What happens today |
| --- | --- |
| Error handling for tool arguments | `JSON.parse(tc.function?.arguments)` throws on invalid JSON and kills the run. Unknown tool names do reach the model, because `executeToolCall` returns an error object. |
| Error handling for tool exceptions | The search and fetch handlers catch their own errors, so in practice this is covered, but the loop itself does not guarantee it. |
| Parallel execution | Tool calls run one after another with `await`. |
| A cap on tool calls per turn | None. The runaway run asked for 2,621 in one turn. |
| Loop detection | None. |
| Output size control | Only inside `fetchWebPage`, which keeps the first 20,000 characters and says nothing about the rest. |
| Validation of the final answer | None. The caller parses it and fails if it is wrong. |
| An empty reply | Returned as if it were the answer. |
| Retries on model errors | None in the loop. |

Two OpenAI-lineage behaviours we already have by hand: `required` is relaxed to `auto` after the first tool round (OpenAI Agents SDK `reset_tool_choice`, OpenRouter Agent SDK `relaxForcedToolChoice`, Microsoft Agent Framework), and the schema is sent on every free turn together with the tools (OpenAI Agents SDK, Vercel AI SDK, Mastra, Codex).

## 3. Side-by-side comparison

"Error to model" means the harness turns the problem into a tool result the model reads, and the run continues. "Crashes" means the run ends with an exception unless you configure otherwise.

| System | Kind | Tool calls in one turn | Default turn cap | At the cap | Bad arguments or unknown tool | Exception inside a tool | Output size control | Loop detection |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Ours** | 147-line loop | one after another | `maxTurns` (6 or 8) | **forced final answer** | invalid JSON crashes; unknown tool to model | caught by our handlers | first 20,000 chars of a page | none |
| OpenAI Agents SDK | library, Python and JS | parallel, optional cap | 10 | raises `MaxTurnsExceeded`, or your handler supplies an answer | error to model | error to model | none by default; optional trimmer | none |
| OpenAI Codex CLI | application, Rust | parallel, starts while streaming | none | not applicable | error to model | error to model | 10,000 tokens, keeps start and end, reports original size | none |
| Claude Agent SDK and Claude Code | library driving a closed CLI | read-only tools in parallel | none unless `maxTurns` | ends with `error_max_turns` | error to model, shows first 200 bytes of bad JSON | error to model | over 50,000 chars to a file with a 2,000-char preview | none found |
| Anthropic Tool Runner | SDK helper | TS parallel, Python sequential | none | not applicable | error to model | error to model | none | none |
| Vercel AI SDK | library, TS | parallel, no cap | 1 step by default, 20 for `ToolLoopAgent` | stops; last tool results never seen; typed output throws | one repair hook, then error to model | error to model | none | none |
| OpenRouter Agent SDK | library, TS | parallel, optional cap | none unless `stopWhen` | **forced final answer** | error to model | error to model | none | opt-in, warns at 3, stops at 6 |
| Mastra | framework on AI SDK types | parallel, 10 at once | 5 | stops | coerces common mistakes, then error to model | error to model | opt-in processors | none |
| Google ADK, Python | library | parallel for async tools | 500 model calls | raises | error to model, lists valid tools | **crashes** unless a callback handles it | none | none |
| Google ADK, TypeScript | library | one after another | 500 | raises | error to model | error to model | opt-in compactors | none |
| Gemini CLI | application, TS | parallel unless the model sets `wait_for_previous` | unlimited; subagents 30 turns and 10 minutes | subagents get **one grace turn** to answer | error to model, suggests closest name | error to model | shell output over 40,000 chars keeps start and end, full text to a file | **yes**: same call 5 times, repeated text, LLM judge after 30 turns |
| LangChain `create_agent` | library, Python | parallel | effectively none (9,999) | raises | error to model | **crashes** unless middleware added | opt-in middleware | none |
| LangChain Deep Agents | library on LangChain | parallel | effectively none | raises | error to model | error to model | results over 80,000 chars to a file, preview of first and last 5 lines | none |
| smolagents | library, Python | parallel threads | 20 | **forced final answer** | error to model | error to model, but one failure discards the whole batch | code output 20,000 chars, start and end | none |
| Pydantic AI | library, Python | parallel | 50 requests | raises | retry prompt, 1 retry per tool | **crashes** | none | none |
| OpenHands SDK | library, Python | one after another by default | 500 | ends with ERROR, no answer | error to model, repairs known GLM and MiniMax argument mistakes | error to model | 50,000 chars, start and end | **yes**: nudge after 3 identical errors, stop after 4 identical pairs |
| Strands (AWS) | library, Python | parallel | none | not applicable | error to model | error to model | opt-in | none |
| Microsoft Agent Framework | library, Python and .NET | Python parallel, .NET sequential | 40 | **forced final answer** with `tool_choice: "none"` | error to model | error to model; tools switched off after 3 failing batches | opt-in | none |
| Perplexity Agent API | hosted loop | not documented | 1 step if you only pass `model` | **forced final answer** | not documented | not documented | token budget per page | not documented |
| xAI Agent Tools | hosted loop | parallel | server default, unpublished | **forced final answer** | shown to model, not billed | shown to model | fetch goes through an LLM summarizer | not documented |
| OpenRouter server tools | hosted loop | not documented | 30 tool calls | **forced final answer** | not documented | not documented | `max_content_tokens`, `max_characters` | not documented |

## 4. How each system works

### 4.1 OpenAI Agents SDK (Python and JavaScript, open source)

- **The loop.** `Runner.run` in `src/agents/run.py` runs a `while True` loop. Each turn resends the whole history, calls the model, sorts the output into messages, tool calls and handoffs, and runs the tools. The run ends on a final output, an approval pause, a guardrail trip, or `MaxTurnsExceeded` after 10 turns. At the cap there is no last model call. You can pass an error handler that builds an answer in your own code.
- **Tool execution.** One asyncio task per call, all at once, results kept in call order. An optional per-tool `timeout_seconds` sends "Tool 'x' timed out after N seconds." to the model. Arguments are validated with a Pydantic model built from the function signature. Any exception becomes "An error occurred while running the tool. Please try again. Error: ...".
- **`tool_use_behavior`** decides what a tool result does. The default sends it back to the model. `stop_on_first_tool` makes the first tool's output the final answer with no further model call.
- **Guardrails** are checks that run on the input, the output or each tool call, and can stop the run.
- **Handoffs** are ordinary function tools named `transfer_to_<agent>`. **Agents as tools** run a nested `Runner.run` and return its last message.
- **Context.** The core loop does no truncation or token counting. An opt-in `ToolOutputTrimmer` replaces tool outputs older than 2 turns and longer than 500 characters with a 200-character preview. Compaction exists only through OpenAI's own Responses API.
- **Tracing** is on by default and sends spans to OpenAI's servers, so with an OpenRouter key you would turn it off.
- **Hosted tools** (web search, file search, code interpreter, image generation, hosted MCP) work only with OpenAI models through the Responses API. With the chat completions model class, passing one raises an error.

### 4.2 OpenAI Codex CLI (Rust, open source)

- **The loop** (`core/src/session/turn.rs`) has no turn cap. Tool calls start the moment each one finishes streaming, before the model's reply is complete. The loop ends when the model answers without a tool call.
- **Tool execution.** Parallel, with a read-write lock deciding which tools may overlap. A shell command that runs longer than 10 seconds is not killed: the tool returns a session id and the model can poll it later.
- **Output size.** Every tool output is capped at 10,000 tokens, estimated as 4 bytes each. The cut keeps the first and last halves and inserts "…N tokens truncated…", with a header stating the original size.
- **Compaction** starts at 90% of the context window. A model call writes a "handoff summary", and the new history is the summary plus the most recent user messages.
- **Tools.** `exec_command` (a shell in a sandbox), `write_stdin`, `apply_patch` (free text constrained by a grammar), `update_plan`, `view_image`, OpenAI's hosted `web_search`, and MCP tools. There are no dedicated file-reading tools: the model reads files through the shell. Behind a feature flag, `web.run` offers up to 4 search queries per call plus `open` and `find` inside a page.

### 4.3 Anthropic: Claude Agent SDK, Claude Code, and the Messages API

- **The Agent SDK has no loop of its own.** In both TypeScript and Python it starts the Claude Code command-line program as a child process and exchanges JSON lines with it. When Claude Code needs a permission decision or a hook result, it sends a control request and the SDK runs your callback. It only drives Claude models.
- **The Claude Code loop** is one `while(true)` over a single state object. Each tool call starts as soon as its block finishes streaming. Read-only tools (Read, Glob, Grep, WebFetch, WebSearch, and Bash when the command is classified as read-only) run at the same time; a write waits for them. Several recovery paths re-enter the loop: after a "prompt too long" error it compacts and retries, after hitting the output token limit it nudges, after a reply that claimed a tool call but held none it retries once, and after a reply with only hidden reasoning it nudges once.
- **Per call**, in order: unknown tool, invalid JSON (the model sees the first 200 bytes and "Retry with valid JSON"), schema check, the tool's own input check, hooks, the permission pipeline, the tool, then size limits. Every failure is a tool result marked as an error.
- **Output size.** A text result over 50,000 characters goes to a file, and the model gets `<persisted-output>` with the path and a 2,000-character preview. If the results of one turn add up to more than 200,000 characters, the largest are moved first. Bash output is kept inline up to 30,000 characters. Read returns 2,000 lines by default and refuses a whole file above 25,000 tokens.
- **Compaction** triggers at the context window minus 20,000 minus 13,000 tokens, which is 167,000 on a 200,000-token window. It forks the conversation and asks the same model for a 9-section summary. A lighter "microcompact" replaces old tool results with "[Old tool result content cleared]".
- **Structured output** is a `StructuredOutput` tool that ends the turn, validates the arguments, and allows up to 5 failed attempts.
- **The Messages API** has server tools. `web_search` costs $10 per 1,000 searches, and its result snippets are encrypted so your code cannot read them, though the model can. `web_fetch` costs only tokens and hands the model the page text itself, with no summarizing model. It refuses URLs that have not already appeared in the conversation. Newer versions let Claude write code that filters search and fetch results before they enter its context. There is also server-side compaction and "context editing" that clears old tool results.
- **The Tool Runner** in the Anthropic SDKs is a plain client-side loop with no default cap. It runs tools in parallel in TypeScript and one at a time in Python.

### 4.4 Vercel AI SDK, OpenRouter Agent SDK, Mastra (TypeScript, open source)

- **Vercel AI SDK** (`packages/ai/src/generate-text/generate-text.ts`). A `do…while` loop. Before each step, `prepareStep` may change the model, the tools, `tool_choice` and even replace the messages; that is the hook for context management. Tools run with `Promise.all`. Malformed arguments get one call to an optional `repairToolCall` function, then become an error result. **Stopping at the step limit gives no final answer:** the last tool results are never shown to the model, and reading a typed output throws. A forced `required` that the model ignores throws `ToolChoiceViolationError` rather than falling back. The SDK ships wrappers for every provider's server tools, including web search from Anthropic, OpenAI, Google and xAI, and Exa, Parallel and Perplexity search through Vercel's AI Gateway.
- **OpenRouter Agent SDK** (`@openrouter/agent`). Uses OpenRouter's Responses-style API. Tools run with `Promise.allSettled`. Stop conditions include `stepCountIs`, `maxTokensUsed` and `maxCost` in dollars. When one fires, the pending calls still run and then a final call is made with `tool_choice: "none"` and the message "You have reached the tool-use limit, and tools are no longer available… write your final answer now." That is our design. It also has an opt-in "doom loop" detector for repeated identical calls. Two cautions from the code: with no `stopWhen` there is no limit at all, and model calls are retried on server errors for up to an hour with no request timeout.
- **Mastra** does not run the AI SDK's loop. Its loop is a Mastra workflow that continues while the finish reason is not one of `stop`, `error`, `length` or `content-filter`. In September 2026 a double-wrapped finish reason made that check always false, so every turn ran to the step limit (issue #23746). The fix is merged but unreleased, and the check still continues on any unknown finish reason. Mastra's validation is forgiving: it parses JSON strings inside arguments, drops `null` from optional fields, and only then returns an error to the model.

### 4.5 Google: ADK, Gemini CLI, and the Gemini API

- **ADK Python.** One model call per step, tools in between, persisted as events in a session. The run ends when a reply has no tool calls. The cap is 500 model calls and raises when exceeded. Tools run concurrently, but a plain synchronous Python function blocks the event loop, so they do not actually overlap. If a tool raises and no error callback handles it, the whole run fails. Unknown tools and invalid arguments do go back to the model, with the list of valid tools. Structured output with tools becomes a `set_model_response` tool.
- **ADK TypeScript** runs tools one after another but turns tool exceptions into `{error}` results. It has pluggable compactors, including a `consolidate_context` tool the model can call itself.
- **Gemini CLI** (`packages/core/src`). Tools run in parallel by default, and every tool schema gets an extra `wait_for_previous` flag the model can set to force ordering. Shell output over 40,000 characters keeps the start and end and saves the full text to a file. Compression triggers at half the context window, keeps the newest 30%, and asks the model to summarize the rest into an XML snapshot, followed by a second call asking it to check that summary for omissions. **Loop detection** flags the same tool call repeated 5 times, the same 50-character chunk repeated 10 times, and after 30 turns asks a judge model every 10 turns. The first detection injects a warning, the second aborts. Subagents must finish by calling `complete_task`, whose arguments are validated against a schema. When they run out of turns or time they get one grace turn: "You MUST call `complete_task` immediately with your best answer".
- **Gemini API hosted tools.** Google Search grounding costs $14 per 1,000 queries on Gemini 3 after 5,000 free a month. The caller gets the executed queries, titles, URLs and which sentence cites which source, but never the snippets. URL context fetches up to 20 URLs per request, costs only input tokens, and does not read paywalled pages.

### 4.6 Other open-source frameworks

- **LangChain `create_agent`** compiles to a LangGraph graph with a model node and a tools node. Tools run in parallel. By default only argument errors go to the model; any other tool exception crashes the run. Everything else is opt-in middleware: summarization, tool-call limits (in "continue" mode each call over budget gets an error result and the model carries on), retries, human approval. Structured output either uses the provider's schema support or a tool with retry on parse failure.
- **LangChain Deep Agents** is `create_agent` plus a middleware stack. Its main contribution is evicting large tool results: anything over about 80,000 characters is saved to a virtual file and replaced by the path, the first 5 and last 5 lines, and an instruction to use `read_file` with offset and limit. Its default tools are file tools and `task` for subagents. It has no web tools.
- **smolagents** (HuggingFace). `ToolCallingAgent` forces a tool call on every turn and always includes a `final_answer` tool. At 20 steps it makes a last call without tools asking for the answer. It sends history as plain text ("Calling tools:", "Observation:") rather than native tool messages. `CodeAgent` has the model write Python that calls tools, run in an interpreter that walks the syntax tree with operation and import limits. Its `visit_webpage` tool keeps the first 40,000 characters of a page.
- **Pydantic AI.** A small graph of nodes. Tools run in parallel. Invalid arguments and unknown tools get a retry prompt, with 1 retry per tool by default. Any other exception crashes the run. `UsageLimits` caps requests (50), tool calls, tokens and cost. The default structured output is a `final_result` tool, and when a provider rejects `required` it silently falls back to `auto`, the same fallback we wrote.
- **OpenHands SDK.** The conversation is an append-only event log saved to disk. Tools run one at a time by default. It repairs two argument mistakes it has seen from specific models: lists sent as JSON strings (GLM) and strings sent as arrays of chunks (MiniMax). An empty reply gets "Your last response did not include a function call or a message. Please use a tool to proceed". Its stuck detector is the most complete of any system (see the table). Every tool gets a `security_risk` argument the model fills in.
- **Strands** (AWS). A recursive event loop. Tools run in parallel, and errors, including validation errors, become error results. Throttling errors are retried 6 times with waits from 4 to 240 seconds. Its `web_fetch` tool by default has a separate analyst agent answer the model's question from the page, told to "preserve concrete details (names, numbers, quotes, links)".

### 4.7 Closed hosted agent APIs

These run the whole loop on the vendor's servers. You send a request and get back a final answer plus a record of the tool calls.

- **Perplexity Agent API.** `max_steps` from 1 to 100. At the cap it makes "one final pass to answer from what it has gathered". Passing only `model` without `max_steps` gives 1 step, so tools run but the model never reads their results. `web_search` takes several queries in one call and costs $2.50 per 1,000; `fetch_url` returns extracted snippets and costs $0.50 per 1,000. Tokens are charged at the underlying provider's price with no markup, and cheap models such as DeepSeek v4 Flash are available.
- **xAI Agent Tools.** `max_turns` caps assistant turns, and the server applies an unpublished default. At the cap the agent writes a final answer. Tool outputs are not returned to the caller unless requested. A client-side function call ends the request, and the next request starts a fresh `max_turns` count, so a mixed loop needs its own outer cap. Search costs $5 per 1,000 calls. From 2026-09-21, X search costs $5 per 1,000 posts returned instead of per call.
- **OpenRouter server tools.** `openrouter:web_search` and `openrouter:web_fetch` run inside one request for any model, including Muse. At most 30 tool calls per request; `stop_server_tools_when` accepts step, cost or token conditions. On a stop, pending calls run and one final turn is made with tools disabled. For a model with no native search, the engine is Exa at $0.007 per search.
- **Amazon.** Bedrock Agents went into maintenance mode on 2026-07-30. Its replacement, the AgentCore harness, runs the open-source Strands loop in a small virtual machine per session, with a default of 75 iterations. AgentCore WebSearch costs $7 per 1,000 queries and has no page-fetch tool.
- **Microsoft Agent Framework** (successor of Semantic Kernel and AutoGen; the client library is open source). 40 iterations by default, then a final call with `tool_choice: "none"`. Tools run in parallel in Python. Errors are reported as "Error: Function failed." and after 3 failing batches in a row, tools are switched off. Bing grounding in Azure Foundry costs $14 per 1,000.
- **Research agents as a service.** Exa Agent ($0.012 to $1 per run, with a dollar budget), Parallel Task ($0.005 per `lite` run), Tavily Research and Firecrawl `/agent` take a question and return an answer, and Exa and Parallel return per-field citations with confidence. You choose neither the model nor the step count.

## 5. The tools the model gets

Across all systems, the tools fall into a handful of families.

| Family | Typical tools | Who ships them |
| --- | --- | --- |
| **Web search** | `web_search(query)`, sometimes with several queries per call, date and domain filters | Hosted in Anthropic, OpenAI, Google, xAI, Perplexity, OpenRouter, AWS, Microsoft. Client-side wrappers in smolagents (DuckDuckGo, Serper, Brave, Exa), Pydantic AI (DuckDuckGo, Tavily), Strands (Tavily, Exa). |
| **Web page reading** | `web_fetch(url)`, `open`, `find`, `browse_page(url, instructions)` | See section 6. |
| **Shell and code** | `Bash`, `exec_command`, `run_shell_command`, `terminal`, `code_interpreter`, `python_interpreter` | Every coding agent; hosted sandboxes at OpenAI, Anthropic, Google, xAI, Perplexity. |
| **Files** | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `read_file` with offset and limit, `apply_patch` | Claude Code, Gemini CLI, Deep Agents, OpenHands, Mastra workspaces. Codex reads files through the shell. |
| **Planning** | `TodoWrite`, `update_plan`, `write_todos`, `task_tracker`, `think` | Claude Code, Codex, Gemini CLI, Deep Agents, OpenHands. Manus's blog says rewriting a to-do file keeps goals in the model's recent attention over about 50 tool calls. |
| **Subagents and delegation** | `Agent`/`Task`, `task`, `invoke_agent`, `spawn_agent`, `transfer_to_<agent>`, `agent.as_tool()` | Every framework in some form. |
| **Final answer** | `final_answer`, `final_result`, `StructuredOutput`, `complete_task`, `set_model_response`, `finish` | smolagents, Pydantic AI, Claude Code, Gemini CLI, Google ADK, OpenHands. |
| **Memory** | `memory` (Anthropic), `update-working-memory` and `recall` (Mastra), `load_memory` (ADK) | Mostly for chat products, not relevant to us. |
| **Tool discovery** | `ToolSearch`, `tool_search` | Claude Code, Codex, OpenAI and Anthropic APIs. Only useful with many tools. |
| **Asking the user** | `AskUserQuestion`, `ask_user`, `get_user_choice` | Interactive products. |

## 6. How the model reads the web: four designs

This is the part that matters most for a fact-checking pipeline, because the source verifier needs verbatim text.

**Design A: the page, cut off.** The model gets the page as markdown up to a fixed size. Ours (20,000 characters, start only), smolagents `visit_webpage` (40,000), Pydantic AI `web_fetch` (50,000), Gemini CLI's experimental direct fetch (250,000), OpenRouter `web_fetch` with `max_content_tokens`, and Anthropic's API `web_fetch` with `max_content_tokens`. Verbatim, but anything past the cut is invisible, and the whole page is billed again on every later turn.

**Design B: the page, pageable.** The page is kept outside the conversation, and the model gets a window plus a way to move or search. ChatGPT's browsing tool (`open` at a line number, `find` a pattern, line-numbered citations), Codex's `web.run`, Windsurf's `view_content_chunk`, Deep Agents and Claude Code's file-based output with `read_file` offset and limit, OpenHands' `browser_get_content(start_from_char)`. Verbatim and complete, at the cost of more tool calls.

**Design C: a small model reads the page for the big model.** The main model passes a URL and a question; a cheap model reads the page and answers.

- Claude Code's `WebFetch` sends up to 100,000 characters to Haiku with the main model's prompt. Its instructions cap quotes at 125 characters.
- Gemini CLI's `web_fetch` sends the URLs to Gemini Flash with Google's URL context tool.
- xAI's `browse_page(url, instructions)` passes the page through "the LLM summarizer".
- Strands' `web_fetch` has an analyst agent answer from the page.
- Claude Code's own internal `web-fetch` subagent is a hybrid: about 48,000 characters verbatim, and a labelled summary of the rest.

This saves context and tokens, but the main model only sees a paraphrase. It cannot produce a verbatim supporting quote, and the summarizer can be wrong.

**Design D: passages picked for the query.** The search engine returns the most relevant passages of each page instead of a short snippet: Perplexity's `web_search` (a token budget per page, ranked sub-document spans), Exa highlights through OpenRouter, AgentCore WebSearch's "semantic snippet extraction", Brave LLM Context. Often enough to settle a claim without any fetch, verbatim, but you only see what the ranker picked.

Search results show the same split. Claude Code's `WebSearch` gives the main model only titles, URLs and a nested model's text. Anthropic's and Google's hosted search hide the snippets from your code. Gemini CLI's `google_web_search` returns a Flash-written answer with numbered citations. Our Serper results are raw snippets we can log and audit.

**For us:** Design C is wrong for the verifier, which needs quotes. The research in `RESULTS.md` section 5 already recommends Design B for `web_fetch`. Design D is the case for trying a passage-returning search API.

## 7. Rules the vendor prompts give their models

These come from official docs and, where marked, leaked system prompts of uncertain date and accuracy.

- **Search budgets scale with the task.** Claude.ai (leak, 2026-07): 1 search for a simple fact, 3 to 8 for medium tasks, 8 to 20 for deep ones.
- **Short keyword queries, one entity each.** Perplexity's presets (docs): "plain keywords. Never use quotation marks, AND, OR, or NOT", 2 to 5 words. Perplexity Deep Research (leak): up to 3 queries per call, one entity per query. Claude.ai (leak): 1 to 6 words, broad first. Note that Perplexity's own engine does not parse operators, while Google through Serper does.
- **Several queries per call.** ChatGPT (leak): at most 4 per call. Perplexity: 3.
- **Search to rule alternatives out, not only in.** Claude.ai (leak).
- **Snippets are not sources.** Manus (leak): open the original page. Claude.ai (leak): "search snippets are often too brief".
- **Only fetch URLs already seen.** Anthropic's `web_fetch` enforces it (docs); Claude.ai's prompt repeats it (leak). It stops a model inventing URLs, which our runaway run did.
- **Recency filters by phrase.** ChatGPT (leak): 1 day for breaking news, 7 for "this week", 30 for "this month".
- **One rule to avoid.** Perplexity's presets say "Never refuse… commit to your single most likely answer". For fact-checking, "not enough evidence" is a valid outcome.

## 8. What this means for our loop

Ordered by value per effort. These refine recommendation 1 in `RESULTS.md`.

1. **Catch invalid tool arguments and send the error to the model.** Today a malformed `arguments` string throws and kills the claim check. Claude Code's message is a good template: say it was not valid JSON, show the first 200 characters, ask for a retry.
2. **Run a turn's tool calls with `Promise.all`,** keeping results in call order and each call's failure as its own result. smolagents shows the trap: one failed call must not discard the siblings' paid Serper results.
3. **Cap tool calls per turn and per run, as tool results rather than crashes.** LangChain's "continue" mode and Anthropic's `max_uses` return "budget used, answer with what you have" to each call over the limit. The Common Notes rater already does this per run (`budgetedToolExecutor` in `rateClaims.ts`, 12 searches and 6 fetches). The X search step has no such budget, and neither has a cap per turn. A cache of URLs already fetched in the run makes repeats free.
4. **Detect repeated identical calls.** A hash of tool name plus arguments; warn the model on the third repeat, drop the call on the fifth. No model call needed.
5. **Nudge on an empty reply** instead of returning it as the answer, once.
6. **Keep the forced final answer.** Consider OpenRouter's wording, which says why tools are gone.
7. **Tell the model its remaining budget** in each tool result. Several systems do; the research evidence is in `RESULTS.md` section 6.
8. **Do not adopt a framework for the loop.** None has a better loop. The Vercel AI SDK and Mastra would lose our forced final answer; LangChain, Pydantic AI and ADK Python crash on tool exceptions by default; the OpenRouter Agent SDK is closest to our behaviour but is beta and retries for up to an hour. Adding the eight items above to our 147 lines is smaller than any migration.

Not relevant to us at 6 to 8 turns: compaction (every trigger is above 100,000 tokens), approvals, permissions, sessions, handoffs and subagents.

## 9. Sources and how far to trust them

| System | Version read | How |
| --- | --- | --- |
| OpenAI Agents SDK | Python commit 1d17ca4, JS commit 506f736 (2026-09-16/17) | source |
| OpenAI Codex CLI | commit e269f21 (2026-09-17) | source |
| OpenAI Responses API hosted tools | docs 2026-09-17, checked against `openai-python` types | docs |
| Claude Agent SDK | npm 0.3.274, GitHub TS and Python | source |
| Claude Code | CLI 2.1.274 | minified JavaScript carved from the compiled binary; constants and strings readable, names not |
| Anthropic Messages API tools, Tool Runner | docs 2026-09-17; `anthropic-sdk-typescript` and `-python` | docs and source |
| Vercel AI SDK | `ai` 7.0.105, commit 6dcd923 | source |
| OpenRouter Agent SDK | `@openrouter/agent` 0.11.0, commit e31b50e | source |
| Mastra | `@mastra/core` 1.68.0-alpha.3, commit b2f412ae | source |
| Google ADK | Python 2.9.0 commit 7ae1c9b, JS 2.1.0 commit aad4b8a | source |
| Gemini CLI | 0.62.0-nightly, commit 6a466a7 | source |
| Gemini API hosted tools | docs 2026-09-17, read through a summarizing fetch | docs |
| LangChain, LangGraph, Deep Agents, smolagents, Pydantic AI, OpenHands, Strands | clones of 2026-09-17 | source |
| Perplexity, xAI, AWS, Microsoft, Exa, Parallel, Tavily, Firecrawl, OpenRouter server tools | docs 2026-09-17, plus open client SDKs | docs and source |
| ChatGPT, Claude.ai, Gemini app, Perplexity, Manus, Cursor, Windsurf prompts | `asgeirtj/system_prompts_leaks`, `jujumilk3/leaked-system-prompts`, `x1xhlol/system-prompts-and-models-of-ai-tools` | leaks of uncertain date and accuracy |

Not verified by running anything: every behaviour here was read, not executed. Specific open points the readers flagged: whether Anthropic's `pause_turn` really ends a Vercel AI SDK run, whether OpenRouter's `finishReasonIs` stop condition can ever fire, the server-side behaviour of every hosted loop, and whether the web search parameters OpenAI documents but its SDK types lack actually exist.
