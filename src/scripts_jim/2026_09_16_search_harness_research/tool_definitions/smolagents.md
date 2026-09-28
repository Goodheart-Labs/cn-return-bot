# smolagents (Hugging Face): tool definitions

Source: `sdks/huggingface_smolagents` (clone read 2026-09-23). Paths below are relative to that folder.
Everything here runs in the harness's own Python process unless noted. smolagents has no hosted tools.

Two families matter for web research:

1. The **library default tools** in `src/smolagents/default_tools.py`: several `web_search` variants, `visit_webpage`, `wikipedia_search`, `final_answer`, `python_interpreter`, `user_input`.
2. The **text browser** of the `open_deep_research` example (`examples/open_deep_research/scripts/text_web_browser.py`, adapted from Microsoft AutoGen's GAIA browser). It gives the model a stateful Lynx-like browser: a page is cut into fixed-size "viewports", and the model scrolls and Ctrl+F-searches inside it. This example is Hugging Face's GAIA deep-research entry, so its tool set is the most research-specific thing in the repo.

## Index

| Tool name (model sees) | Class | File:line | Runs in | One-line summary |
|---|---|---|---|---|
| `web_search` | `DuckDuckGoSearchTool` | `src/smolagents/default_tools.py:104` | harness (calls `ddgs` library) | 10 results, `[title](url)\nbody` |
| `web_search` | `GoogleSearchTool` | `default_tools.py:162` | harness (SerpAPI or Serper HTTP) | numbered results with date, source, snippet; optional `filter_year` |
| `web_search` | `ApiWebSearchTool` | `default_tools.py:249` | harness (Brave API by default) | 10 numbered results, title/url/description |
| `web_search` | `WebSearchTool` | `default_tools.py:342` | harness (scrapes DDG lite, Bing RSS, or Exa API) | title/link/description; Exa variant uses highlights |
| `visit_webpage` | `VisitWebpageTool` | `default_tools.py:491` | harness (`requests` + `markdownify`) | whole page as markdown, cut at 40,000 chars |
| `wikipedia_search` | `WikipediaSearchTool` | `default_tools.py:547` | harness (`wikipedia-api`) | full article text or summary |
| `final_answer` | `FinalAnswerTool` | `default_tools.py:83` | harness | the only way to end a run |
| `python_interpreter` | `PythonInterpreterTool` | `default_tools.py:39` | harness (restricted AST interpreter) | calculations |
| `user_input` | `UserInputTool` | `default_tools.py:93` | harness (stdin) | ask the human |
| `web_search` | `SearchInformationTool` | `examples/open_deep_research/scripts/text_web_browser.py:373` | harness (SerpAPI) | search results rendered as a browser "page" |
| `visit_page` | `VisitTool` | `text_web_browser.py:394` | harness | opens a URL, returns the first viewport |
| `page_up` / `page_down` | `PageUpTool` / `PageDownTool` | `text_web_browser.py:488` / `:504` | harness | scroll one viewport |
| `find_on_page_ctrl_f` | `FinderTool` | `text_web_browser.py:522` | harness | jump to viewport with first match (wildcards `*`) |
| `find_next` | `FindNextTool` | `text_web_browser.py:550` | harness | jump to next matching viewport |
| `find_archived_url` | `ArchiveSearchTool` | `text_web_browser.py:445` | harness (Wayback Machine API) | opens archived snapshot closest to a date |
| `download_file` | `DownloadTool` | `text_web_browser.py:410` | harness | saves non-HTML files to disk |
| `inspect_file_as_text` | `TextInspectorTool` | `examples/open_deep_research/scripts/text_inspector_tool.py:5` | harness + **nested LLM call** | reads a file (PDF, docx...) and answers a question about it |

## How tool definitions reach the model

smolagents has two agent types, and they present tools differently.

- `ToolCallingAgent` sends native function-calling JSON built by `get_tool_json_schema` (`src/smolagents/models.py:288`). Every input without `"nullable": True` becomes required, and type `"any"` is sent as `"string"`. The system prompt additionally lists every tool as text through `to_tool_calling_prompt` (`src/smolagents/tools.py:289`):
  ```
  {name}: {description}
      Takes inputs: {inputs dict}
      Returns an output of type: {output_type}
  ```
- `CodeAgent` does not use function calling. The model writes Python, and tools are Python functions in its namespace. The system prompt shows each tool as a Python signature plus docstring via `to_code_prompt` (`tools.py:258`): `def name(arg: type, ...) -> output_type:` followed by the description and an `Args:` block with each input's description.

Tool outputs are not truncated by `ToolCallingAgent` (`agents.py:1401`: `observation = str(tool_call_result).strip()`). In `CodeAgent`, the value of the last expression is cut to 20,000 characters, keeping the first and last 10,000 (`utils.py:254-265`, `MAX_LENGTH_TRUNCATE_CONTENT = 20000`), and printed output is cut at 50,000 characters (`local_python_executor.py:57`, `DEFAULT_MAX_LEN_OUTPUT = 50000`). The truncation marker is:
```
\n..._This content has been truncated to stay below 20000 characters_...\n
```

---

## Library default tools (`src/smolagents/default_tools.py`)

### `web_search` (DuckDuckGoSearchTool)

- **Runs in:** harness process, via the `ddgs` Python package (DuckDuckGo scraping library).
- **Description, verbatim:**
  ```
  Performs a duckduckgo web search based on your query (think a Google search) then returns the top search results.
  ```
- **Parameters (model fills):**
  | name | type | required | description |
  |---|---|---|---|
  | `query` | string | yes | `The search query to perform.` |
- **Developer configuration:** `max_results` (default 10), `rate_limit` (default 1.0 query per second; the tool sleeps to enforce it), plus kwargs for the `DDGS` client.
- **What it does (`default_tools.py:140-146`):** calls `DDGS().text(query, max_results=10)`. If zero results, it raises `Exception("No results found! Try a less restrictive/shorter query.")`, which the agent loop shows to the model as an error. Otherwise it returns:
  ```
  ## Search Results

  [Title one](https://example.com/a)
  Snippet body text one...

  [Title two](https://example.com/b)
  Snippet body text two...
  ```
  This is the tool that `TOOL_MAPPING` registers under the name `web_search`, so it is the library's default search.

### `web_search` (GoogleSearchTool)

- **Runs in:** harness process, HTTP GET to SerpAPI (`https://serpapi.com/search.json`) or Serper (`https://google.serper.dev/search`).
- **Description, verbatim:**
  ```
  Performs a google web search for your query then returns a string of the top search results.
  ```
- **Parameters (model fills):**
  | name | type | required | description |
  |---|---|---|---|
  | `query` | string | yes | `The search query to perform.` |
  | `filter_year` | integer | no (nullable) | `Optionally restrict results to a certain year` |
- **Developer configuration:** `provider` = `"serpapi"` (default, env `SERPAPI_API_KEY`) or anything else for Serper (env `SERPER_API_KEY`).
- **What it does (`default_tools.py:190-246`):** sends `q` (and for SerpAPI `engine=google`, `google_domain=google.com`). If `filter_year` is set it adds Google's date-range operator `tbs=cdr:1,cd_min:01/01/{year},cd_max:12/31/{year}`. No result count is set, so the provider default applies (10 for both). It formats every organic result, 0-indexed, including the publication date and source when the provider returns them:
  ```
  ## Search Results
  0. [Title](https://link)
  Date published: Mar 3, 2024
  Source: Reuters

  snippet text...

  1. [Title](https://link)
  ...
  ```
  Error texts the model can see: `No results found for query: '{query}' with filtering on year={filter_year}. Use a less restrictive query or do not filter on year.` (raised), and the returned string `No results found for '{query}'{ with filter year=...}. Try with a more general query, or remove the year filter.`
  This is the search tool the `open_deep_research` example actually uses, with `provider="serper"` (`examples/open_deep_research/run.py`, `create_agent`). It is therefore the closest analogue of our own Serper-backed `google_search`; the only extras are the date line, the source line, and the year filter.

### `web_search` (ApiWebSearchTool)

- **Runs in:** harness process, HTTP GET to Brave Search by default (`https://api.search.brave.com/res/v1/web/search`, header `X-Subscription-Token`).
- **Description, verbatim:**
  ```
  Performs a web search for a query and returns a string of the top search results formatted as markdown with titles, URLs, and descriptions.
  ```
- **Parameters:** `query` (string, required, `The search query to perform.`).
- **Developer configuration:** `endpoint`, `api_key`, `api_key_name` (default env `BRAVE_API_KEY`), `headers`, `params` (default `{"count": 10}`), `rate_limit` (default 1/s).
- **What it does (`default_tools.py:312-339`):** reads `data["web"]["results"]`, keeps title, url and description, and returns `## Search Results\n\n1. [title](url)\ndescription\n\n2. ...` (1-indexed). Empty result returns `No results found.`

### `web_search` (WebSearchTool)

- **Runs in:** harness process. Engine `duckduckgo` scrapes `https://lite.duckduckgo.com/lite/` with a hand-written HTML parser; `bing` reads Bing's RSS output (`format=rss`); `exa` calls `https://api.exa.ai/search` with `contents: {"highlights": true}`.
- **Description, verbatim:**
  ```
  Performs a web search for a query and returns a string of the top search results formatted as markdown with titles, links, and descriptions.
  ```
- **Parameters:** `query` (string, required, `The search query to perform.`).
- **Developer configuration:** `max_results` (default 10; note the DuckDuckGo lite path does not apply it), `engine` (`"duckduckgo"` default, `"bing"`, `"exa"`).
- **What it does (`default_tools.py:353-488`):** returns `## Search Results\n\n[title](link)\ndescription` per result. With Exa the "description" is Exa's query-relevant highlights joined by spaces (`default_tools.py:485`), so the snippet is chosen for the query rather than being the page's meta description. Zero results raise `No results found! Try a less restrictive/shorter query.`

### `visit_webpage` (VisitWebpageTool)

- **Runs in:** harness process (`requests.get` + `markdownify`).
- **Description, verbatim:**
  ```
  Visits a webpage at the given url and reads its content as a markdown string. Use this to browse webpages.
  ```
- **Parameters:**
  | name | type | required | description |
  |---|---|---|---|
  | `url` | string | yes | `The url of the webpage to visit.` |
- **Developer configuration:** `max_output_length` (default 40,000 characters).
- **What it does (`default_tools.py:515-544`):** GET with a 20-second timeout and no custom User-Agent. The whole HTML body goes through `markdownify` (no readability or boilerplate removal, so navigation menus and footers stay in), runs of three or more newlines are collapsed to two, and the result is cut at the first 40,000 characters with this suffix:
  ```
  \n..._This content has been truncated to stay below 40000 characters_...\n
  ```
  Failures are returned as text, not raised: `The request timed out. Please try again later or check the URL.`, `Error fetching the webpage: {e}`, `An unexpected error occurred: {e}`.
  There is no way to read past the cut. In `CodeAgent` the model can work around that in code, because the return value is a Python string it can slice or search with `re` before printing.

### `wikipedia_search` (WikipediaSearchTool)

- **Runs in:** harness process (`wikipediaapi` package).
- **Description, verbatim:**
  ```
  Searches Wikipedia and returns a summary or full text of the given topic, along with the page URL.
  ```
- **Parameters:** `query` (string, required, `The topic to search on Wikipedia.`).
- **Developer configuration:** `user_agent`, `language` (default `en`), `content_type` (`"text"` default, or `"summary"`), `extract_format` (`"WIKI"` default or `"HTML"`).
- **What it does (`default_tools.py:623-643`):** not a search at all. It calls `wiki.page(query)`, which is an exact title lookup. The result has no length limit:
  ```
  ✅ **Wikipedia Page:** {title}

  **Content:** {full article text}

  🔗 **Read more:** {url}
  ```
  Missing page: `No Wikipedia page found for '{query}'. Try a different query.`

### `final_answer` (FinalAnswerTool)

- **Runs in:** harness process.
- **Description, verbatim:**
  ```
  Provides a final answer to the given problem.
  ```
- **Parameters:** `answer`, type `any` (sent to function-calling models as `string`), required, description `The final answer to the problem`.
- **What it does (`default_tools.py:89-90`):** returns its argument unchanged. The agent loop treats a call to it as the end of the run. Developers can attach `final_answer_checks` (functions that must return true for the answer to be accepted, `agents.py` `_validate_final_answer`); a failing check becomes an error the model sees, and the loop continues.
- **Prompt rules (from `src/smolagents/prompts/toolcalling_agent.yaml`), verbatim:**
  ```
  To provide the final answer to the task, use an action blob with "name": "final_answer" tool. It is the only way to complete the task, else you will be stuck on a loop.
  ```
  and rule 3 of the rules list:
  ```
  3. Call a tool only when needed: do not call the search agent if you do not need information, try to solve the task yourself. If no tool call is needed, use final_answer tool to return your answer.
  ```
  When smolagents runs as a sub-agent ("managed agent"), the task is wrapped in this template (`toolcalling_agent.yaml`, `managed_agent.task`), which dictates the shape of the final answer:
  ```
  You're a helpful agent named '{{name}}'.
  You have been submitted this task by your manager.
  ---
  Task:
  {{task}}
  ---
  You're helping your manager solve a wider task: so make sure to not provide a one-line answer, but give as much information as possible to give them a clear understanding of the answer.

  Your final_answer WILL HAVE to contain these parts:
  ### 1. Task outcome (short version):
  ### 2. Task outcome (extremely detailed version):
  ### 3. Additional context (if relevant):

  Put all these in your final_answer tool, everything that you do not pass as an argument to final_answer will be lost.
  And even if your task resolution is not successful, please return as much context as possible, so that your manager can act upon this feedback.
  ```
  If `max_steps` (default 20) runs out without a final answer, the harness makes one extra model call with the whole memory and this prompt (`final_answer.pre_messages` / `post_messages`):
  ```
  An agent tried to answer a user query but it got stuck and failed to do so. You are tasked with providing an answer instead. Here is the agent's memory:
  ```
  ```
  Based on the above, please provide an answer to the following user task:
  {{task}}
  ```

### `python_interpreter` (PythonInterpreterTool)

Brief, since it is not a research tool. Description: `This is a tool that evaluates python code. It can be used to perform calculations.` Input `code`, whose description is built at init time: `The code snippet to evaluate. All variables used in this snippet must be defined in this same snippet, else you will get an error. This code can only import the following python libraries: {authorized_imports}.` It runs smolagents' own restricted AST interpreter (not `exec`) with a 30-second timeout (`MAX_EXECUTION_TIME_SECONDS = 30`) and returns `Stdout:\n{prints}\nOutput: {value}`.

### `user_input` (UserInputTool)

Description: `Asks for user's input on a specific question`. Input `question` (`The question to ask the user`). Reads from stdin.

---

## The text browser (`examples/open_deep_research/scripts/text_web_browser.py`)

All of these tools share one `SimpleTextBrowser` object, so they have state: the current page, the current viewport, the find query, and the visit history.

**Viewport design.** When a page loads, its full markdown text is kept in memory and split into consecutive chunks of `viewport_size` characters, each extended forward to the next whitespace so words are not split (`_split_pages`, lines 182-198). The library default is `1024 * 8` = 8,192 characters (line 28); the example's `run.py` sets `"viewport_size": 1024 * 5` = 5,120 characters. Search result pages are never split. Only one viewport is ever returned to the model at a time.

**Every browser tool returns the same header** (`_state`, lines 355-370) followed by a separator and the current viewport:
```
Address: https://en.wikipedia.org/wiki/Example
Title: Example - Wikipedia
You previously visited this page 42 seconds ago.
Viewport position: Showing page 1 of 7.
=======================
<up to 5,120 characters of page text>
```
The "previously visited" line appears only on a revisit. The "page N of M" line is how the model knows how much text is left.

**Page conversion.** `_fetch_page` (lines 263-353) uses the example's own `MarkdownConverter` (`scripts/mdconvert.py`, a precursor of Microsoft's MarkItDown), which handles HTML, PDF, DOCX, XLSX, PPTX, audio transcripts, and YouTube pages (returns the transcript). Requests use `request_kwargs` from `run.py`: a desktop Edge User-Agent, a 300-second timeout, and a hard-coded cookie jar (`scripts/cookies.py`). Non-text content types are saved to `downloads_folder` and then opened as a local file. HTTP errors are rendered as a page (`## Error 404\n\n...`), not raised.

### `web_search` (SearchInformationTool)

- **Description, verbatim:**
  ```
  Perform a web search query (think a google search) and returns the search results.
  ```
- **Parameters:**
  | name | type | required | description |
  |---|---|---|---|
  | `query` | string | yes | `The web search query to perform.` |
  | `filter_year` | string | no (nullable) | `[Optional parameter]: filter the search results to only include pages from a specific year. For example, '2020' will only include pages from 2020. Make sure to use this parameter if you're trying to search for articles from a specific date!` |
- **What it does (lines 388-391, 204-259):** navigates the browser to the pseudo-address `google: {query}`, which calls SerpAPI and renders the results as a page:
  ```
  Address: google: population of Guangzhou
  Title: population of Guangzhou - Search
  Viewport position: Showing page 1 of 1.
  =======================
  A Google search for 'population of Guangzhou' found 10 results:

  ## Web Results
  1. [Guangzhou - Wikipedia](https://en.wikipedia.org/wiki/Guangzhou)
  Date published: ...
  Source: ...
  You previously visited this page 120 seconds ago.

  snippet...
  ```
  The distinctive detail: each result line says whether and how long ago the model already visited that URL (`_prev_visit`, line 228).
  Note: the example's `run.py` does not register this class. It uses the library `GoogleSearchTool(provider="serper")` described above, so in the shipped configuration the search results do not carry the "previously visited" marker.

### `visit_page` (VisitTool)

- **Description, verbatim:**
  ```
  Visit a webpage at a given URL and return its text. Given a url to a YouTube video, this returns the transcript.
  ```
- **Parameters:** `url` (string, required, `The relative or absolute url of the webpage to visit.`). Relative URLs are resolved against the previous address (lines 65-74), so the model can follow a link it saw on the page.
- **What it does (lines 404-407):** loads the page, resets to viewport 1, returns the header plus the first viewport (5,120 characters in `run.py`).

### `page_up` / `page_down` (PageUpTool / PageDownTool)

- **Descriptions, verbatim:**
  ```
  Scroll the viewport UP one page-length in the current webpage and return the new viewport content.
  ```
  ```
  Scroll the viewport DOWN one page-length in the current webpage and return the new viewport content.
  ```
- **Parameters:** none.
- **What they do (lines 99-103, 498-519):** move the viewport index by one, clamped to the first and last viewport, and return header plus viewport. There is no "go to page N".

### `find_on_page_ctrl_f` (FinderTool)

- **Description, verbatim:**
  ```
  Scroll the viewport to the first occurrence of the search string. This is equivalent to Ctrl+F.
  ```
- **Parameters:**
  | name | type | required | description |
  |---|---|---|---|
  | `search_string` | string | yes | `The string to search for on the page. This search string supports wildcards like '*'` |
- **What it does (lines 105-175, 537-547):** starting at the current viewport and wrapping around, it finds the first viewport whose text matches. Matching is word-based and case-insensitive: both the query and each viewport are split on non-word characters and rejoined with single spaces, and `*` becomes the regex `.*` (lines 152-171). So `"GDP * 2021"` matches "GDP grew in 2021", and punctuation differences are ignored. The whole viewport containing the match is returned; the match itself is not highlighted and no position inside the viewport is given. Repeating the same query while already on the matching viewport acts as `find_next`. No match:
  ```
  Address: ...
  Viewport position: Showing page 3 of 7.
  =======================
  The search string 'GDP * 2021' was not found on this page.
  ```
  A match that straddles a viewport boundary is missed, because each viewport is searched separately.

### `find_next` (FindNextTool)

- **Description, verbatim:**
  ```
  Scroll the viewport to next occurrence of the search string. This is equivalent to finding the next match in a Ctrl+F search.
  ```
- **Parameters:** none.
- **What it does (lines 124-145, 560-567):** continues from the viewport after the last match, wrapping to the start. Because the unit is the viewport, several matches inside one viewport count as one; `find_next` skips to the next viewport that has any match. Returns `The search string was not found on this page.` when nothing else matches.

### `find_archived_url` (ArchiveSearchTool)

- **Description, verbatim:**
  ```
  Given a url, searches the Wayback Machine and returns the archived version of the url that's closest in time to the desired date.
  ```
- **Parameters:**
  | name | type | required | description |
  |---|---|---|---|
  | `url` | string | yes | `The url you need the archive for.` |
  | `date` | string | yes | `The date that you want to find the archive for. Give this date in the format 'YYYYMMDD', for instance '27 June 2008' is written as '20080627'.` |
- **What it does (lines 461-485):** queries `https://archive.org/wayback/available?url=...&timestamp=...`; if there is no snapshot near the date it falls back to the query without a timestamp; if neither has one it raises `Your url='...' was not archived on Wayback Machine, try a different url.` Otherwise it opens the snapshot in the browser and returns:
  ```
  Web archive for url https://example.com, snapshot taken at date 20080627:
  Address: http://web.archive.org/web/20080627.../https://example.com
  ...
  =======================
  <first viewport>
  ```
  For fact-checking this is interesting in two ways: it recovers dead pages, and it lets the model read a page as it stood at the time a claim was made.

### `download_file` (DownloadTool)

- **Description, verbatim:**
  ```

  Download a file at a given URL. The file should be of this format: [".xlsx", ".pptx", ".wav", ".mp3", ".m4a", ".png", ".docx"]
  After using this tool, for further inspection of this page you should return the download path to your manager via final_answer, and they will be able to inspect it.
  DO NOT use this tool for .pdf or .txt or .htm files: for these types of files use visit_page with the file url instead.
  ```
- **Parameters:** `url` (string, required, `The relative or absolute url of the file to be downloaded.`).
- **What it does (lines 423-442):** rewrites arXiv `abs` URLs to `pdf`, saves to `./downloads/file{ext}`, and returns `File was downloaded and saved under path {path}.` PDF, TXT and HTML downloads raise an error telling the model to use `visit_page`.

### `inspect_file_as_text` (TextInspectorTool), a nested LLM call

- **Runs in:** harness process for conversion, then a **second call to the same model** when a question is given.
- **Description, verbatim** (`text_inspector_tool.py:7-9`):
  ```

  You cannot load files yourself: instead call this tool to read a file as markdown text and ask questions about it.
  This tool handles the following file extensions: [".html", ".htm", ".xlsx", ".pptx", ".wav", ".mp3", ".m4a", ".flac", ".pdf", ".docx"], and all other types of text files. IT DOES NOT HANDLE IMAGES.
  ```
- **Parameters:**
  | name | type | required | description |
  |---|---|---|---|
  | `file_path` | string | yes | `The path to the file you want to read as text. Must be a '.something' file, like '.pdf'. If it is an image, use the visualizer tool instead! DO NOT use this tool for an HTML webpage: use the web_search tool instead!` |
  | `question` | string | no (nullable) | `[Optional]: Your question, as a natural language sentence. Provide as much context as possible. Do not pass this parameter if you just want to directly return the content of the file.` |
- **Developer configuration:** `model`, `text_limit` (default 100,000; `run.py` sets 100,000 characters).
- **What it does (`text_inspector_tool.py:76-124`):** converts the file with `MarkdownConverter`. Without a question it returns the full converted text, uncut. With a question it sends the first 100,000 characters to the model with this conversation, and returns the model's reply as the tool result:
  - system: `You will have to write a short caption for this file, then answer this question:{question}`
  - user: `Here is the complete file:\n### {title}\n\n{text[:100000]}`
  - user: `Now answer the question below. Use these three headings: '1. Short answer', '2. Extremely detailed answer', '3. Additional Context on the document and question asked'.{question}`

  This is the "read a long document through a sub-model" pattern: the calling agent never sees the document, only the answer. There is also an unused variant, `forward_initial_exam_mode`, that asks for a 5-sentence caption and says `Don't answer the question yourself! Just provide useful notes on the document`.

### How the example wires the browser (`examples/open_deep_research/run.py`)

The browser tools belong to a sub-agent called `search_agent`, a `ToolCallingAgent` with `max_steps=20` and `planning_interval=4` (it writes a new plan every 4 steps). Its tools are `GoogleSearchTool(provider="serper")`, `visit_page`, `page_up`, `page_down`, `find_on_page_ctrl_f`, `find_next`, `find_archived_url`, and `inspect_file_as_text`. A `CodeAgent` manager (`max_steps=12`) calls it. The manager sees this description of the sub-agent, verbatim:
```
A team member that will search the internet to answer your question.
    Ask him for all your questions that require browsing the web.
    Provide him as much context as possible, in particular if you need to search on a specific timeframe!
    And don't hesitate to provide him with a complex search task, like finding a difference between two webpages.
    Your request must be a real sentence, not a google search! Like "Find me this information (...)" rather than a few keywords.
```
and the sub-agent's task template is extended with, verbatim:
```
You can navigate to .txt online files.
    If a non-html page is in another format, especially .pdf or a Youtube video, use tool 'inspect_file_as_text' to inspect it.
    Additionally, if after some searching you find out that you need more information to answer the question, you can use `final_answer` with your request for clarification as argument to request for more information.
```

---

## Prompt rules that govern tool use

### Tool-calling agent (`src/smolagents/prompts/toolcalling_agent.yaml`), rules list, verbatim
```
Here are the rules you should always follow to solve your task:
1. ALWAYS provide a tool call, else you will fail.
2. Always use the right arguments for the tools. Never use variable names as the action arguments, use the value instead.
3. Call a tool only when needed: do not call the search agent if you do not need information, try to solve the task yourself. If no tool call is needed, use final_answer tool to return your answer.
4. Never re-do a tool call that you previously did with the exact same parameters.
```

### Code agent (`src/smolagents/prompts/code_agent.yaml`), the parts about tools, verbatim
```
4. For tools WITHOUT JSON output schema: Take care to not chain too many sequential tool calls in the same code block, as their output format is unpredictable. For instance, a call to wikipedia_search without a JSON output schema has an unpredictable return format, so do not have another tool call that depends on its output in the same block: rather output results with print() to use them in the next block.
5. For tools WITH JSON output schema: You can confidently chain multiple tool calls and directly access structured output fields in the same code block! When a tool has a JSON output schema, you know exactly what fields and data types to expect, allowing you to write robust code that directly accesses the structured response (e.g., result['field_name']) without needing intermediate print() statements.
6. Call a tool only when needed, and never re-do a tool call that you previously did with the exact same parameters.
...
11. Don't give up! You're in charge of solving the task, not providing directions to solve it.
```
The code agent's worked example shows the intended search-then-read pattern, including visiting two pages in one code block with a loop:
```
Thought: I will read the first 2 pages to know more.
{{code_block_opening_tag}}
for url in ["https://ahf.nuclearmuseum.org/voices/oral-histories/stanislaus-ulams-interview-1979/", "https://ahf.nuclearmuseum.org/manhattan-project/ulam-manhattan-project/"]:
    whole_page = visit_webpage(url)
    print(whole_page)
    print("\n" + "="*80 + "\n")  # Print separator between pages
{{code_block_closing_tag}}
```
It also shows recovering from a zero-result search by broadening the query:
```
Thought: The query was maybe too restrictive and did not find any results. Let's try again with a broader query.
```

### Planning and budget awareness (both YAML files, `planning.update_plan_post_messages`), verbatim excerpt
When `planning_interval` is set, every N steps the model gets a planning turn with a facts survey. The update prompt tells it how many steps are left:
```
Now write your updated facts below, taking into account the above history:
## 1. Updated facts survey
### 1.1. Facts given in the task
### 1.2. Facts that we have learned
### 1.3. Facts still to look up
### 1.4. Facts still to derive

Then write a step-by-step high-level plan to solve the task above.
## 2. Plan
### 2. 1. ...
Etc.
This plan should involve individual tasks based on the available tools, that if executed correctly will yield the correct answer.
Beware that you have {remaining_steps} steps remaining.
Do not skip steps, do not add any superfluous steps. Only write the high-level plan, DO NOT DETAIL INDIVIDUAL TOOL CALLS.
After writing the final step of the plan, write the '<end_plan>' tag and stop there.
```
This is the only budget signal smolagents gives the model, and only during planning turns. Ordinary steps carry no step counter. There is no time, token or cost awareness.

## What is distinctive

- **Search result shape:** markdown list of `[title](url)` plus snippet. The Google/Serper variant adds `Date published:` and `Source:` lines and a `filter_year` argument. No result IDs, no dedup across calls.
- **Page reading:** two opposite designs. `visit_webpage` returns the whole page up to 40,000 characters in one shot with no way to continue. The text browser returns 5,120-character viewports with a "page N of M" header, and the model scrolls or Ctrl+F-jumps.
- **In-page search:** `find_on_page_ctrl_f` / `find_next` jump to the viewport containing a wildcard, punctuation-insensitive match. The match position is not marked, and a match split across two viewports is missed.
- **Citations:** none. No tool returns quotable spans with IDs, and no prompt asks for citations.
- **Final answer:** an explicit `final_answer` tool is the only way to finish. Sub-agents must structure it in three headings (short, extremely detailed, additional context).
- **Budget:** `max_steps` (default 20) is enforced silently; the remaining step count appears only in replanning prompts.
- **Nested model reading:** `inspect_file_as_text` hands up to 100,000 characters to a second model call and returns only its answer.
