# Web research tools in other consumer and agent products (leaked prompts)

This file collects, verbatim, the web research tools and the rules around them from leaked system prompts of Manus, Cursor, Windsurf, Kimi, DeepSeek, Mistral Le Chat, Meta AI, and briefly Qwen and Microsoft Copilot.

**Trust note for the whole file.** Every source here is a leak: a user coaxed the model into printing its own instructions, and a community repository saved the output. Leaks can be incomplete, paraphrased by the model, stitched from several sessions, or simply outdated, and nobody at the vendors has confirmed any of them. Some special characters did not survive: several prompts (Meta, Microsoft Copilot) show citation markers that were written in Unicode private-use characters, and the leak shows an empty pair of backticks where the marker should be. The three repositories were cloned shallowly (only the latest commit), so the git commit date of a file is just the date of the latest repository snapshot (system_prompts_leaks: 2026-09-15, leaked-system-prompts: 2026-09-03, system-prompts-and-models-of-ai-tools: 2026-08-11). Where a prompt states its own "current date", that date is given instead; the jujumilk3 repository puts a capture date in each file name.

Repository roots (all under the scratchpad `sdks/` folder):
- `system_prompts_leaks/` (asgeirtj)
- `leaked-system-prompts/` (jujumilk3)
- `system-prompts-and-models-of-ai-tools/` (x1xhlol)

---

## 1. Manus

- **Sources:** `system-prompts-and-models-of-ai-tools/Manus Agent Tools & Prompt/tools.json` and `Modules.txt`; the same text is in `leaked-system-prompts/manus_20250310.md`.
- **Date:** captured 2025-03-10 (file name). This is the launch-era Manus and is old.
- **Shape of the harness:** one search tool with a date filter, plus a full browser driven by element indexes. Snippets are explicitly not valid sources; the model must open the page.

### Tools

**info_search_web**
```json
{
  "type": "function",
  "function": {
    "name": "info_search_web",
    "description": "Search web pages using search engine. Use for obtaining latest information or finding references.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query in Google search style, using 3-5 keywords."
        },
        "date_range": {
          "type": "string",
          "enum": [
            "all",
            "past_hour",
            "past_day",
            "past_week",
            "past_month",
            "past_year"
          ],
          "description": "(Optional) Time range filter for search results."
        }
      },
      "required": [
        "query"
      ]
    }
  }
}
```

**browser_navigate**
```json
{
  "type": "function",
  "function": {
    "name": "browser_navigate",
    "description": "Navigate browser to specified URL. Use when accessing new pages is needed.",
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "Complete URL to visit. Must include protocol prefix."
        }
      },
      "required": [
        "url"
      ]
    }
  }
}
```

**browser_view**
```json
{
  "type": "function",
  "function": {
    "name": "browser_view",
    "description": "View content of the current browser page. Use for checking the latest state of previously opened pages.",
    "parameters": {
      "type": "object"
    }
  }
}
```

**browser_scroll_down** (browser_scroll_up is the mirror image with `to_top`)
```json
{
  "type": "function",
  "function": {
    "name": "browser_scroll_down",
    "description": "Scroll down the current browser page. Use when viewing content below or jumping to page bottom.",
    "parameters": {
      "type": "object",
      "properties": {
        "to_bottom": {
          "type": "boolean",
          "description": "(Optional) Whether to scroll directly to page bottom instead of one viewport down."
        }
      }
    }
  }
}
```

**browser_click**
```json
{
  "type": "function",
  "function": {
    "name": "browser_click",
    "description": "Click on elements in the current browser page. Use when clicking page elements is needed.",
    "parameters": {
      "type": "object",
      "properties": {
        "index": {
          "type": "integer",
          "description": "(Optional) Index number of the element to click"
        },
        "coordinate_x": {
          "type": "number",
          "description": "(Optional) X coordinate of click position"
        },
        "coordinate_y": {
          "type": "number",
          "description": "(Optional) Y coordinate of click position"
        }
      }
    }
  }
}
```

The browser also has `browser_restart`, `browser_input`, `browser_move_mouse`, `browser_press_key`, `browser_select_option`, `browser_console_exec` (run JavaScript) and `browser_console_view`. These are interaction tools rather than reading tools, so they are only listed by name here.

### Usage rules (verbatim, `Modules.txt`)

**Information priority and search style**
```
<info_rules>
- Information priority: authoritative data from datasource API > web search > model's internal knowledge
- Prefer dedicated search tools over browser access to search engine result pages
- Snippets in search results are not valid sources; must access original pages via browser
- Access multiple URLs from search results for comprehensive information or cross-validation
- Conduct searches step by step: search multiple attributes of single entity separately, process multiple entities one by one
</info_rules>
```

**How pages are read (what the model sees)**
```
<browser_rules>
- Must use browser tools to access and comprehend all URLs provided by users in messages
- Must use browser tools to access URLs from search tool results
- Actively explore valuable links for deeper information, either by clicking elements or accessing URLs directly
- Browser tools only return elements in visible viewport by default
- Visible elements are returned as `index[:]<tag>text</tag>`, where index is for interactive elements in subsequent browser actions
- Due to technical limitations, not all interactive elements may be identified; use coordinates to interact with unlisted elements
- Browser tools automatically attempt to extract page content, providing it in Markdown format if successful
- Extracted Markdown includes text beyond viewport but omits links and images; completeness not guaranteed
- If extracted Markdown is complete and sufficient for the task, no scrolling is needed; otherwise, must actively scroll to view the entire page
- Use message tools to suggest user to take over the browser for sensitive operations or actions with side effects when necessary
</browser_rules>
```

**Data APIs before the web**
```
<datasource_module>
- System is equipped with data API module for accessing authoritative datasources
- Available data APIs and their documentation will be provided as events in the event stream
- Only use data APIs already existing in the event stream; fabricating non-existent APIs is prohibited
- Prioritize using APIs for data retrieval; only use public internet when data APIs cannot meet requirements
- Data API usage costs are covered by the system, no login or authorization needed
- Data APIs must be called through Python code and cannot be used as tools
- Python libraries for data APIs are pre-installed in the environment, ready to use after import
- Save retrieved data to files instead of outputting intermediate results
</datasource_module>
```

**Planning and note-keeping during research**
```
<todo_rules>
...
- Must use todo.md to record and update progress for information gathering tasks
...
</todo_rules>
```
```
<file_rules>
...
- Actively save intermediate results and store different types of reference information in separate files
...
</file_rules>
```
```
<agent_loop>
...
4. Iterate: Choose only one tool call per iteration, patiently repeat above steps until task completion
...
</agent_loop>
```

**Citation**
```
<writing_rules>
...
- When writing based on references, actively cite original text with sources and provide a reference list with URLs at the end
...
</writing_rules>
```

---

## 2. Cursor

- **Sources:**
  - `system_prompts_leaks/Cursor/cursor.md` (undated; it mentions subagent types such as `codex-rescue` and a `SwitchMode` tool, so it is a 2026-era Cursor).
  - `system-prompts-and-models-of-ai-tools/Cursor Prompts/Agent Tools v1.0.json` and `Agent Prompt 2.0.txt` (undated in the repository; Cursor 2.0 shipped in late October 2025, and `leaked-system-prompts/cursor-ide-2.0_20251029.md` carries the same `web_search` signature).
- **Shape of the harness:** one search tool that takes a single string, and in the newest leak a separate fetch tool that returns markdown. No page windowing, no find, no citation format. Cursor is a coding agent, so web research is a side feature.

### Tools

**web_search** (x1xhlol `Agent Tools v1.0.json`)
```json
{
  "description": "Search the web for real-time information about any topic. Use this tool when you need up-to-date information that might not be available in your training data, or when you need to verify current facts. The search results will include relevant snippets and URLs from web pages. This is particularly useful for questions about current events, technology updates, or any topic that requires recent information.",
  "name": "web_search",
  "parameters": {
    "properties": {
      "explanation": {
        "description": "One sentence explanation as to why this tool is being used, and how it contributes to the goal.",
        "type": "string"
      },
      "search_term": {
        "description": "The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant.",
        "type": "string"
      }
    },
    "required": [
      "search_term"
    ],
    "type": "object"
  }
}
```

The same tool in the TypeScript-style form of `Agent Prompt 2.0.txt`:
```
// Search the web for real-time information about any topic. Use this tool when you need up-to-date information that might not be available in your training data, or when you need to verify current facts. The search results will include relevant snippets and URLs from web pages. This is particularly useful for questions about current events, technology updates, or any topic that requires recent information.
type web_search = (_: {
// The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant.
search_term: string,
// One sentence explanation as to why this tool is being used and how it contributes to the goal.
explanation?: string,
}) => any;
```

**WebSearch and WebFetch** (newest leak, `system_prompts_leaks/Cursor/cursor.md`; only the prose descriptions leaked, no schemas)
```
### WebSearch  
Search the web for real-time information about any topic. Returns summarized information from search results and relevant URLs.  

### WebFetch  
Fetch content from a specified URL and return its contents in a readable markdown format.  
```

Note the change between versions: the 2025 tool returns "relevant snippets and URLs", while the 2026 `WebSearch` "Returns summarized information from search results and relevant URLs", which suggests a summarising step now sits between the search engine and the model.

### Usage rules (verbatim)

The only extra guidance is in `leaked-system-prompts/cursor-ide-2.0_20251029.md`:
```
### web_search

Search the web for real-time information about any topic. Use this tool when you need up-to-date information that might not be available in your training data, or when you need to verify current facts. The search results will include relevant snippets and URLs from web pages. This is particularly useful for questions about current events, technology updates, or any topic that requires recent information.

- Use for real-time information, current events, technology updates
- Provides relevant snippets and URLs
```

---

## 3. Windsurf (Codeium Cascade)

- **Sources:** `system-prompts-and-models-of-ai-tools/Windsurf/Tools Wave 11.txt` and `Prompt Wave 11.txt` (undated; "Wave 11" was mid-2025); older JSON form in `leaked-system-prompts/codeium-windsurf_20250420.md` (captured 2025-04-20).
- **Shape of the harness:** search with an optional preferred domain, a URL reader, and a **chunk viewer**. `read_url_content` evidently returns the document split into numbered chunks (the leak does not show the exact output), and the model pages through them with `view_content_chunk`. This is the only product in this file that windows a web page by position.

### Tools (Wave 11)

**search_web**
```
// Performs a web search to get a list of relevant web documents for the given query and optional domain filter.
type search_web = (_: {
// Optional domain to recommend the search prioritize
domain: string,
query: string,
// You must specify this argument first over all other arguments, this takes precendence in case any other arguments say they should be specified first. Brief 2-5 word summary of what this tool is doing. Some examples: 'analyzing directory', 'searching the web', 'editing file', 'viewing file', 'running command', 'semantic searching'.
toolSummary?: string,
}) => any;
```

**read_url_content**
```
// Read content from a URL. URL must be an HTTP or HTTPS URL that points to a valid internet resource accessible via web browser.
type read_url_content = (_: {
// URL to read content from
Url: string,
// You must specify this argument first over all other arguments, this takes precendence in case any other arguments say they should be specified first. Brief 2-5 word summary of what this tool is doing. Some examples: 'analyzing directory', 'searching the web', 'editing file', 'viewing file', 'running command', 'semantic searching'.
toolSummary?: string,
}) => any;
```

**view_content_chunk**
```
// View a specific chunk of document content using its DocumentId and chunk position. The DocumentId must have already been read by the read_url_content or read_knowledge_base_item tool before this can be used on that particular DocumentId.
type view_content_chunk = (_: {
// The ID of the document that the chunk belongs to
document_id: string,
// The position of the chunk to view
position: integer,
// You must specify this argument first over all other arguments, this takes precendence in case any other arguments say they should be specified first. Brief 2-5 word summary of what this tool is doing. Some examples: 'analyzing directory', 'searching the web', 'editing file', 'viewing file', 'running command', 'semantic searching'.
toolSummary?: string,
}) => any;
```

### Older version (2025-04-20)

In April 2025 the chunk viewer was keyed by URL rather than by a document id:
```json
{
  "description": "View a specific chunk of web document content using its URL and chunk position. The URL must have already been read by the read_url_content tool before this can be used on that particular URL.",
  "name": "view_web_document_content_chunk",
  "parameters": {
    "properties": {
      "position": {
        "description": "The position of the chunk to view",
        "type": "integer"
      },
      "url": {
        "description": "The URL that the chunk belongs to",
        "type": "string"
      }
    },
    "type": "object"
  }
}
```

### Usage rules

The Windsurf prompt has no rules about web search, query style, budgets or citation. The only research rule is about the codebase (`Prompt Wave 11.txt`), and is quoted because its "never guess" stance is the general research posture:
```
<code_research>
If you are not sure about file content or codebase structure pertaining to the user's request, proactively use your tools to search the codebase, read files and gather relevant information: NEVER guess or make up an answer. Your answer must be rooted in your research, so be thorough in your understanding of the code before answering or making code edits.
You do not need to ask user permission to research the codebase; proactively call research tools when needed.
</code_research>
```

---

## 4. Kimi (Moonshot AI)

- **Sources:** `system_prompts_leaks/Kimi/kimi-3.md` (Kimi K3; undated, says its training knowledge is "current only to early 2026"); `system_prompts_leaks/Kimi/kimi-2.6.md` (Kimi K2.6; the prompt states "Session: 2026-07-14 01:49").
- **Shape of the harness:** a search tool that takes an **array of queries run in parallel**, an open-URL tool that takes an **array of URLs**, footnote-style citations `[^N^]` numbered by search-result position, and (in K3) an optional real-browser tool suite with `find` and `scroll`. K2.6 has a hard 25-step budget per turn.

### Tools

**mshtools-web_search** (Kimi K3)
```yaml
  {
    "name": "mshtools-web_search",
    "description": "Web Search API, works like Google Search.",
    "parameters": {
      "type": "object",
      "properties": {
        "queries": {
          "description": "Search directly by queries. All queries will be searched in parallel.
If you want to search with multiple keywords, put them in a single query.",
          "items": { "type": "string" },
          "type": "array"
        }
      },
      "required": ["queries"]
    }
  },
```

**mshtools-web_open_url** (Kimi K3)
```yaml
  {
    "name": "mshtools-web_open_url",
    "description": "Open and read a URL.",
    "parameters": {
      "type": "object",
      "properties": {
        "urls": {
          "description": "URLs to fetch.",
          "items": { "type": "string" },
          "type": "array"
        }
      },
      "required": ["urls"]
    }
  },
```

**Browser suite** (Kimi K3; loadable on demand, schemas not in the leak)
```
- the mshtools-browser_* suite (visit, click, input, find, scroll, screenshot): a real browser for fine-grained page operations. Load only when the task needs that.
```

**web_search and web_open_url** (Kimi K2.6)
```ts
namespace default {

// Web search engine. Returns top results with snippets.
type web_search = (_: {
// Query string(s) sent to the search engine (default 1). Only use multiple (max 2) when the question contains genuinely independent sub-topics.
queries: string[],
}) => any;

// Open and read a URL.
type web_open_url = (_: {
// URLs to fetch.
urls: string[],
}) => any;
```

The two Kimi versions disagree on multi-query use: K3 says all queries run in parallel with no cap, K2.6 says default one query and at most two.

### Usage rules (verbatim)

**When to search, recency, and how many rounds (K3)**
```
`<search_and_current_information>`

Your training knowledge is current only to early 2026. What feels to you like "the future" has very likely already happened: trust search results over your memory, and don't keep bringing up your knowledge cutoff.

Before answering, judge whether the conclusion is time-stable. If there's any real chance it has changed — prices, exchange rates, news, policy, who currently holds a role, phrasing like "latest" / "now" / "still?", or a settled-sounding claim asked in the present tense — search first, and search the assumption itself rather than the answer you already have in mind. The same goes for niche, fast-moving, or memory-risky topics. Use the actual current year in your queries. A single fact usually needs one round of search; the more complex the question, the more rounds you run, until the sources are enough to support the answer.

Default to not searching when you're working over text the user already gave you (editing, polishing, translating, rewriting). Not searching is not license to guess — when you lack the information, state your basis or ask.
```

**Citation format (K3)**
```
Citations — [^N^]: when you use searched information in your answer, place the marker right after the fact or figure it supports, where N is the source's number in the search results (e.g. ...supports a 1M-token context [^1^].); when several sources back one fact, mark them together as [^7^][^8^]. In messages, footnote definitions are unnecessary — the frontend matches and renders each marker automatically — so skip them. Markdown files are different: [^N^] markers there need matching footnote definitions at the bottom (e.g. [^1^]: https://...) so generic Markdown parsers can resolve them.
```

**Deep research is a skill, not a tool (K3)**
```
- deep-research: multi-source research, evidence collection, comparative analysis, synthesis, and structured investigation before drafting an answer or deliverable. Use when the task requires research depth rather than only straightforward execution.
```

**Step budget, query style and year (K2.6)**
```
[CRITICAL] You are limited to a maximum of 25 steps per turn (a turn starts when you receive a user message and ends when you deliver a final response). Most tasks can be completed with 0–3 steps depending on complexity.

web_search queries: 1-6 words, match user language, use date operators when needed.  

web_open_url: open a user-provided URL to read its content.  
```
```
For finance/stock/economy/Chinese law data: always call get_data_source_desc → get_data_source before web_search.  

IMPORTANT - use the correct year in search queries! Example: If current timestamp is 2026-08-15 08:30 and the user asks for "latest React docs", search for "React documentation 2026"，NOT "React documentation 2025".  
```
```
cite: [^N^]; image: `![t](url)` exact url; download: `[t](sandbox:///mnt/agents/output/f)`; math: LaTeX; html: code block.
```

---

## 5. DeepSeek (chat.deepseek.com)

- **Source:** `system_prompts_leaks/DeepSeek/deepseek-chat.md`. The prompt states "Current date: 2026-07-14".
- **Shape of the harness:** the entire leaked prompt is one tool. Several queries are packed into one string separated by `||`. There is no open-URL tool and no usage rules.

### Tool (verbatim, this is the whole file apart from the date and location lines)
```json
{
  "name": "search",
  "description": "Web search. Split multiple queries with '||'.",
  "parameters": {
    "type": "object",
    "properties": {
      "queries": {
        "type": "string",
        "description": "query1||query2"
      }
    },
    "required": ["queries"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
```

---

## 6. Mistral Le Chat

- **Sources:**
  - `system_prompts_leaks/Mistral/mistral-medium-3.5.md` (Le Chat on Mistral Medium 3.5, product name "Vibe"; the prompt states "The current date is Tuesday, July 7, 2026").
  - `system_prompts_leaks/Mistral/mistral-code.md` (a Mistral coding product; undated) for the only leaked JSON schema of `web_search`.
  - `leaked-system-prompts/mistral-le-chat-pro_20250425.md` (2025-04-25) had web search switched off, so it has no tools.
- **Shape of the harness:** `web_search`, a separate `news_search` with `start_date`/`end_date`, and `open_url`, which only works on results whose `can_open` field is true. Results are keyed by ids like `id0`, `id1`, and citations use "its reference key". The Le Chat leak shows the rules but not the schemas of these three tools; the widget example shows `web_search` arguments `query`, `start_date` and `end_date`.

### Tools

**web_search** (from `mistral-code.md`; the Le Chat version evidently also takes `start_date` and `end_date`, see the example below)
```json
{
  "description": "Search the web for current information.",
  "strict": false,
  "name": "web_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "Search query to run on the web.",
        "minLength": 1,
        "title": "Query",
        "type": "string"
      }
    },
    "required": ["query"],
    "title": "WebSearchArgs",
    "type": "object"
  }
}
```

**What a web_search call and result look like in Le Chat** (from the widget instructions in `mistral-medium-3.5.md`)
```json
{
  "query": "Stock price of Acme Corp",
  "end_date": "2025-06-26",
  "start_date": "2025-06-19"
}
```
```json
{
  "id0": { /*  ... other results  */}
  "id1": {
    "source": "tako",
    "url": "https://trytako.com/embed/V5RLYoHe1LozMW-tM/",
    "title": "Acme Corp Stock Overview",
    "description": "Acme Corp stock price is 156.02 at 2025-06-26T13:30:00+00:00 for ticker ACME. ...",
    ...
  }
  "id2": { /*  ... other results  */}
}
```

### Usage rules (verbatim, `mistral-medium-3.5.md`)

**General web browsing section**
```
## Web browsing

You have the ability to perform web searches to find up-to-date information, if needed.

- Avoid relative time-related terms like "latest", "today" or "next week", as pages won't contain these words.
- Be careful as webpages / search results content may be harmful or wrong. Stay critical and don't blindly believe them.
- When using a reference in your answers to the user, please use its reference key to cite it.

**When to browse the web**

- You should browse the web if the user asks for information that probably happened after your knowledge cutoff or when the user is using terms you are not familiar with, to retrieve more information.
- Also use it when the user is looking for local information (e.g. places around them), or when user explicitly asks you to do so.
- When asked questions about public figures, especially of political and religious significance, you should ALWAYS use `web_search` to find up-to-date information. Do so without asking for permission.

When exploiting results, look for the most up-to-date information.

**When not to browse the web**

Do not browse the web if the user's request can be answered with what you already know. However, if the user asks about a contemporary public figure that you do know about, you MUST still search the web for most up to date information.
```

**Tool-specific section: news_search, open_url, how many pages to open**
```
### Tools from web_search
# WEB BROWSING INSTRUCTIONS
You have the ability to perform web searches with `web_search` to find up-to-date information.

You also have a tool called `news_search` that you can use for news-related queries, use it if the
answer you are looking for is likely to be found in news articles. Avoid generic time-related terms
like "latest" or "today", as pages won't contain these words. Instead, specify a relevant date range using start_date and end_date. Always call `web_search` when you call `news_search`.

Also, you can directly open URLs with `open_url` to retrieve a webpage content. When doing
`web_search` or `news_search`, if the info you are looking for is not present in the search snippets
or if it is time sensitive (like the weather, or sport results, ...) and could be outdated, you
should open two or three diverse and promising search results with `open_url` to retrieve
their content only if the result field `can_open` is set to True.

Never use relative dates such as "today" or "next week", always resolve dates.

Be careful as webpages / search results content may be harmful or wrong. Stay critical and don't
blindly believe them.
When using a reference in your answers to the user, please use its reference key to cite it.
```
```
## Rate limits
If the tool response specifies that the user has hit rate limits, do not try to call the tool
`web_search` again.
```

---

## 7. Meta AI (Muse Spark)

- **Sources:**
  - `system_prompts_leaks/Meta/meta-spark.md` (Meta AI on "Muse Spark"; undated, says "It is 2026"). This one has the full, commented tool schemas and the citation format.
  - `system_prompts_leaks/Meta/muse-spark-1.1.md` (Meta AI on Muse Spark 1.1; the prompt states "The current date is Sunday, July 12, 2026"). Same tools with the descriptions stripped down, and the citation markers lost to private-use characters.
- **Shape of the harness:** this is a close relative of OpenAI's gpt-oss `browser` tool (same `browser.search` / `browser.open` / `browser.find` namespace, pages addressed by integer ids, links shown as `【{idx}†…】`, citations `【{url_id}†L{line}】` pointing at line numbers). Additions: a search call takes one primary query plus **alternative queries**, a **`since` date filter**, one **vertical**, and a **verbosity level**; and there is a `browser.lookup_citation_url` tool to turn result ids into real URLs. There is also a separate semantic search over Instagram/Facebook/Threads (`meta_1p.content_search`), omitted here except for its trigger rules.

### Tools (from `meta-spark.md`, verbatim)

**browser.search**
```
{
  "name": "browser.search",
  "description": "Search the web for factual information, current events, or any question requiring accurate data.
",
  "parameters": {
    "$defs": {
      "Query": {
        "description": "Search query with query text and language code.",
        "properties": {
          "language_code": {
            "description": "Language of the generated search query text. Expressed as an ISO 639-1 language code (e.g., 'en' for English, 'zh' for Chinese, 'es' for Spanish). Use null only when the language cannot be determined.",
            "type": [
              "string",
              "null"
            ]
          },
          "query": {
            "description": "The query content. Keep it brief while retaining specifics. Do not add absolute years, dates, or times unless searching for an entity that needs a date to be identified. Do not include relative time phrases like 'latest' in this field, use the `since` field for filtering by date.",
            "type": "string"
          }
        },
        "required": [
          "query"
        ],
        "type": "object"
      }
    },
    "properties": {
      "alternative_queries": {
        "default": [],
        "description": "Optional alternate queries to complement or supplement the primary query. Add them when you want to search for content in multiple ways, (e.g. the content you are searching for has multiple aspects, comparisons, technical jargon, etc that could benefit from rephrasing). It is not helpful to repeat the primary query with trivial rewording. Depending on the user's location, if content is likely to be found in a different language, add a translated alternative query with the appropriate language code.",
        "items": {
          "$ref": "#/$defs/Query"
        },
        "type": "array"
      },
      "primary_query": {
        "$ref": "#/$defs/Query",
        "description": "Main search query with essential context."
      },
      "since": {
        "description": "Optional recency filter for webpages posted on or after the date (YYYY-MM-DD). Set only when the user explicitly requests a timeframe or recency constraint (maybe expressed in relative terms, e.g. this week)",
        "type": [
          "string",
          "null"
        ]
      },
      "verbosity_level": {
        "default": "high",
        "description": "Output verbosity level: 'low' (concise) or 'high' (default, more detail).",
        "enum": [
          "low",
          "high"
        ],
        "type": "string"
      },
      "verticals": {
        "description": "Verticals relevant to the search. If you set this field, special per-vertical handling in this tool is triggered. You MUST set this field to a vertical if the user's message is related to the verticals. Include at most ONE vertical: if the message relates to multiple verticals, set this field to the most relevant one. For example, if the user is messaging about sports, including the 'sports' vertical enables this tool to pull real time data, such as scores and schedules.",
        "items": {
          "enum": [
            "news",
            "sports",
            "weather",
            "finance",
            "datetime",
            "local"
```
(The leak is cut off at this point. The Muse Spark 1.1 leak adds `"product_help"` to the vertical enum.)

**browser.open**
```
{
  "name": "browser.open",
  "description": "Opens the link `outlink_idx` from the page indicated by `url_id` starting at line number `line_start`.
Valid link ids are displayed with the formatting: `【{outlink_idx}†.*】`.
If `url_id` is a string, it is treated as a fully qualified URL. `outlink_idx` follows an outlink from that page.
If `url_id` is an integer search result page ID, `outlink_idx` selects which result to open.
If `outlink_idx` is not given, `url_id` is treated as the page to be opened.
If `line_start` is not provided, the viewport will be positioned at the beginning of the document or centered on the most relevant passage, if available.
Use this function without `outlink_idx` to scroll to a new location of an opened page.
",
  "parameters": {
    "$defs": {
      "UrlIdParam": {
        "anyOf": [
          {
            "format": "uint64",
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "string"
          }
        ],
        "description": "A page reference: either an integer page ID or a fully-qualified URL string."
      }
    },
    "properties": {
      "line_start": {
        "description": "0-indexed line number to start displaying from. Sets the viewport position in the resulting page.",
        "format": "uint",
        "minimum": 0,
        "type": [
          "integer",
          "null"
        ]
      },
      "outlink_idx": {
        "description": "Index of an outlink in the referenced page to follow (shown as 【idx†…】 in page content). Works with either an integer page ID or a URL string. When url_id is a search session ID (integer from web.search, also called search result page ID), this parameter is required and selects which result to fetch (0 = first result, 1 = second, etc.). Also works to follow outlinks shown as 【{outlink_idx}†…】 in page content.",
        "format": "uint",
        "minimum": 0,
        "type": [
          "integer",
          "null"
        ]
      },
      "url_id": {
        "$ref": "#/$defs/UrlIdParam",
        "description": "Page reference: an integer page ID from a previous browser.search or browser.open result, or a fully-qualified URL string (https://...) to fetch directly."
      }
    },
    "required": [
      "url_id"
    ],
    "type": "object"
  }
}
```

**browser.find**
```
{
  "name": "browser.find",
  "description": "Finds exact matches of `pattern` in the page given by `url_id`
",
  "parameters": {
    "properties": {
      "line_start": {
        "description": "0-indexed line number to start searching from. Useful for finding later occurrences after a previous browser.find call.",
        "format": "uint",
        "minimum": 0,
        "type": [
          "integer",
          "null"
        ]
      },
      "pattern": {
        "description": "Text to search for (case-insensitive exact match).",
        "type": "string"
      },
      "url_id": {
        "description": "Integer page ID from a previous browser.open result to search within.",
        "format": "uint64",
        "minimum": 0,
        "type": "integer"
      }
    },
    "required": [
      "pattern",
      "url_id"
    ],
    "type": "object"
  }
}
```

**browser.lookup_citation_url** (from `muse-spark-1.1.md`, which has only terse descriptions)
```
{
  "name": "browser.lookup_citation_url",
  "description": "Resolve search result URLs.",
  "parameters": {
    "properties": {
      "outlink_indices": { "default": [], "items": { "format": "uint", "minimum": 0, "type": "integer" }, "type": "array" },
      "url_id": { "format": "uint64", "minimum": 0, "type": "integer" }
    },
    "required": ["url_id"],
    "type": "object"
  }
}
```

### Usage rules (verbatim, `meta-spark.md` unless marked)

**When to search**
```
Search when the answer would benefit from current information or facts you're unsure about. Refer to the current date provided above to stay oriented in time. It is 2026; events, people, and cultural context have evolved since your training data. When in doubt about whether something is still current, search. Evaluate `browser.search` and the `meta_1p.content_search` content tools independently. If a query matches both criteria, call both in parallel.  
```
```
Call `browser.search` when having access to information from the internet is necessary to write a helpful and accurate response. This includes, but is not limited to, responses that need:  
- up-to-date information about a topic  
- a variety of sources  
- news (breaking news, current events, headlines),  
- local information (local businesses, restaurants, "near me", "in [city]", directions)  
- sports (scores, results, standings, stats, schedules, playoffs),  
- weather (forecasts, temperature),  
- finance (stock prices, market data, crypto, earnings)  

It's also a good idea to use search when looking for detailed information about a niche topic or information that's not commonly known.  

Further, to get accurate information about the time, events, timezones, holidays, use `browser.search` and set the vertical to `datetime`.  

Do not call `browser.search` when you do not need information from the internet to write a helpful and accurate response. For common knowledge such as simple math, geography, history, science, well-known facts, or famous works, you generally don't need to search. To greet the user, have small talk, or other similar situations, search is not necessary.  

Tasks like creative writing, writing assistance, grammar, or language translation, also typically do not require a search. Neither does responding to hypothetical or speculative questions. That being said, if you need to search to write an accurate and helpful response, you should search.  
```

**Query style and dates**
```
`<execution>`  
- Call the tool immediately, never announce your intention to search.  
- If any part of a query requires search, search first. Do not provide partial answers.  
- An important detail about how you use search is how you include dates. As a general principle, do not include dates, years, or times in the search query. Instead, to filter for timely results, use the `since` field to filter for documents that were published after a certain date. The singular important exception to this rule is when you cannot uniquely identify the entity without mentioning a date or year. For example, the entities "super bowl last year", "University of Waterloo course catalog 2018", "next presidential election", "2017 Nissan Altima", "next month’s Costco coupons" are entities that need a date to be identified.  
- Use the current 2026 date (provided above) when setting the `since` field to make searches date-aware. Anchor relative time references ("this week", "recently", "latest") to today's date.  
- `browser.search` also has special handling for searching real time information about the following verticals: news, weather, finance, sports, local, and datetime (queries about dates, time, and events). If the query is about one of those verticals, be sure to set it in your tool call.  
- If you cannot access a URL or resource the user mentions, try searching for key terms from it instead.  

`</execution>`  
```

**Agentic, iterative, parallel (Muse Spark 1.1)**
```
You are agentic. For complex questions, decompose and chain multiple tool calls: search for context, open pages, run code, synthesize. Plan independent lookups up front and issue in parallel; only sequence when dependent.
```
```
Search is agentic. You can search, evaluate, search again iteratively.
```
```
**Search tool independence:** Having user context does not reduce need to search. When query matches search criteria, call search regardless.
```

**Missing evidence**
```
If you could not access a specific URL or resource the user asked about, be honest about it. Share what you found from searching, and if that's not enough, ask the user to paste the content or upload the file.  
```

**Citation format and placement**
```
When writing your response, give the user the answer, not a list of sources. Lead with the key finding, then build out with relevant detail and context. Do not present search result URLs directly, use citations.  
```
```
### Citations  
Citation format:  
- `browser.search`: `【{url_id}†L{line}】` or `【{url_id}†L{start}-L{end}】`.  
- `meta_1p.content_search`: `【post-{post_id}】`.  

Citation placement:  
- Cite once per section, not once per fact. Each section of your response (headed by a markdown heading, or a logical paragraph/list group) gets at most one citation block at its end. Gather every source used in that section into a single group of markers. Individual bullets never get their own citation. Tables never have citations inside cells; cite after the table.  
- If you cannot cleanly place a citation at a section boundary, drop it.  
- Place punctuation before citations: `Text.【16348836503601069257†L9】`  
```
The two Meta leaks disagree on placement. `meta-spark.md` says "Individual bullets never get their own citation". Muse Spark 1.1 (2026-07-12) says the reverse for lists:
```
- Place citations inline at end of paragraph/list item they support. In prose, cite once per section. In bulleted/numbered lists, cite each item individually. Tables never have citations inside cells; cite after table. Punctuation before citations.
```

**Grounding and no fabricated tool output (Muse Spark 1.1)**
```
Be grounded in the data from the tools for anything beyond well-known facts. Citations and inline posts are the only way to prove your sources and methods.
```
```
- Do not narrate, simulate, fabricate tool output (image embed, file path, search result, citation, ID) as if called tool. If reasoning concludes tool needed, call it rather than describing result not produced.
```
```
- Muse Spark 1.1 launched July 9, 2026 on dev.meta.ai. Search results before date won't know.
```

---

## 8. Qwen (Alibaba, chat.qwen.ai), brief

- **Sources:** `system_prompts_leaks/Qwen/qwen3.6-plus.md` (states "Friday, April 03, 2026") and `qwen3.8-max.md` (states "Wednesday, August 05, 2026"). Both have the same two web tools and no usage rules at all.
- **Shape:** an array of queries, and a page extractor that takes several URLs plus a `goal`. With a goal, the page is **summarised against that goal** before the model sees it; with an empty goal, the raw page comes back. This is the Tongyi DeepResearch "visit with goal" pattern.

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "Search for information from the internet.",
    "parameters": {
      "type": "object",
      "properties": {
        "queries": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "The search query."
          },
          "description": "The list of search queries."
        }
      },
      "required": ["queries"]
    }
  }
}
```
```json
{
  "type": "function",
  "function": {
    "name": "web_extractor",
    "description": "Crawl webpage content, and if given a goal, further summarize the relevant content of the webpage.",
    "parameters": {
      "type": "object",
      "properties": {
        "urls": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "One url."
          },
          "minItems": 1,
          "description": "The webpage urls."
        },
        "goal": {
          "type": "string",
          "description": "The goal of the visit for webpage(s). If empty, return the original content of the webpage(s)."
        }
      },
      "required": ["urls", "goal"]
    }
  }
}
```

---

## 9. Microsoft Copilot (consumer), brief

- **Source:** `leaked-system-prompts/microsoft-copilot_20260328.md` (captured 2026-03-28). The schema of its `search_web` tool is not in the leak, but the rules are unusually specific about query length and about source quality, which is directly relevant to fact-checking. Citation markers use ChatGPT-style reference ids (`turn\d+\w+\d+`) whose surrounding characters were lost in the leak.

### Usage rules (verbatim)

**When to search: always, for any fact**
```
### `search_web`
#### Decision boundary for `search_web`
<situations_where_I_always_use_search_web>
I **ALWAYS** use `search_web` for any request that involves facts, explanations, comparisons, or advice — even when the information is stable or widely known. Every claim I make is backed by fresh, authoritative sources from the web. I never rely solely on core knowledge, assumptions, or memory. This rule applies to all types of claims, including (but not limited to):
- Common knowledge (even if stable, like "Who directed The Matrix?")
- Time‑sensitive information (news, prices, schedules, laws, etc.)
- Location‑specific details (weather, events, regulations)
- High‑stakes accuracy (medical, legal, financial)
- Unfamiliar terms or possible typos
- Recommendations (products, restaurants, shopping)
- Public figures (celebrities, politicians, executives)
- Explicit search requests (e.g., "look up..." "are you sure?")
- Source attribution needs (quotes, citations, links)
- Referenced content (articles, datasets, interviews)
- Academic or educational content (assignments, coursework, research)
- Platform, service, or community-specific information (app policies, account rules, server mechanics)
- Professional standards or technical frameworks (industry certifications, regulatory procedures)
- Rankings, statistics, or demographic data (comparisons, lists, census figures, market data)
- Current time or timezone conversion
```
```
**CRITICAL:** Whenever I'm uncertain or on the fence, I **MUST ALWAYS** default to use `search_web`. Every response that uses search results **REQUIRES** citations.
```

**Query style**
```
#### Generating "query" parameter in `search_web`
- Rephrase the user's query, applying any context from the conversation history, using clear, concise language, specific keywords, or context to translate their message into a search engine query.
- Keep the search query less than 50 characters.
- Focus on nouns, proper names, and specific technical terms. Remove all filler words, articles, and pronouns from queries.
```
```
- User asks about iPhone releases in the past 2 years. Call `search_web` in parallel to get results for each year → {"query":"iphone releases 2024"}, {"query":"iphone releases 2025"}, {"query":"iphone releases 2026"}
```
```
- User asks about the difference in Best Picture Oscar criteria between 1950 and 2020, and the cultural impact of the winning films. Call `search_web` in parallel to get results for each year and their cultural impact → {"query":"Best Picture Oscar criteria 1950"}, {"query":"Best Picture Oscar criteria 2020"}, {"query":"Best Picture Oscar 1950 cultural impact"}, {"query":"Best Picture Oscar 2020 cultural impact"}
```

**How much to cite**
```
If I choose to search, I will obey the following rules related to citations:
- If I make factual statements that are not common knowledge, I must cite the 5 most load-bearing/important statements in my response. Other statements should be cited if derived from web sources.
- In addition, factual statements that are likely (>10% chance) to have changed since June 2024 must have citations
- If I call `search` once, all statements that could be supported a source on the internet should have corresponding citations
```

**Source quality, conflicting sources, inference and missing evidence**
```
<extra_considerations_for_citations>
- **Relevance:** Include only search results and citations that support the cited response text. Irrelevant sources permanently degrade user trust.
- **Diversity:** I must base my answer on sources from diverse domains, and cite accordingly.
- **Trustworthiness:**: To produce a credible response, I must rely on high quality domains, and ignore information from less reputable domains unless they are the only source.
- **Accurate Representation:** Each citation must accurately reflect the source content. Selective interpretation of the source content is not allowed.

Remember, the quality of a domain/source depends on the context
- When multiple viewpoints exist, cite sources covering the spectrum of opinions to ensure balance and comprehensiveness.
- When reliable sources disagree, cite at least one high-quality source for each major viewpoint.
- Ensure more than half of citations come from widely recognized authoritative outlets on the topic.
- For debated topics, cite at least one reliable source representing each major viewpoint.
- Do not ignore the content of a relevant source because it is low quality.
</extra_considerations_for_citations>
```
```
<special_cases>
- When using search to answer technical questions, I must only rely on primary sources (research papers, official documentation, etc.)
- If I failed to find an answer to the user's question, at the end of my response I must briefly summarize what I found and how it was insufficient.
- Sometimes, I may want to make inferences from the sources. In this case, I must cite the supporting sources, but clearly indicate that I am making an inference.
- I must not write URLs directly in the response unless they are in code. Citations will be rendered as links, and other raw markdown links are unacceptable unless the user explicitly asks for a link.
</special_cases>
```

---

## Checked and left out

- **Brave Search Assistant** (`system_prompts_leaks/Misc/brave-search.md`): the leak is a single 138-character sentence with no tools.
- **Kagi Assistant** (`system_prompts_leaks/Misc/kagi-assistant.md`, dated 2025-07-14): no search tool or search rules in the leak, only language handling.
- **Mistral Le Chat Pro, April 2025**: web search was off ("You cannot perform any web search or access the internet to open URLs").
- **Devin** (`leaked-system-prompts/devin_20250908.md`): only a Playwright browser (`navigate_browser`, `view_browser`, …) for testing web apps, no research-oriented search tool.
- **Perplexity Comet**: covered in another file.
