# gpt-oss `browser` tool (OpenAI, open source) — definition, implementation, what the model sees

## Sources and trust

This is the one first-party, fully inspectable tool in this folder. OpenAI released it with the open-weight gpt-oss models (August 2025) as "a reference implementation of the browser tool the models got trained on".

| What | Where (under `scratchpad/sdks/`) | Commit date |
|---|---|---|
| Implementation | `gpt-oss/gpt_oss/tools/simple_browser/` (`simple_browser_tool.py`, `page_contents.py`, `backend.py`) | gpt-oss HEAD `7b58334`, 2026-07-24 |
| Tool definition as the model sees it | `harmony/src/chat.rs` lines 259–309 (`ToolNamespaceConfig::browser()`), rendered in `harmony/test-data/test_browser_tool_only.txt` | harmony HEAD `abd677f`, 2026-04-08 |
| Harmony format docs | `harmony/docs/format.md`, section "Built-in tools → Browser tool" (lines 509–578) | same |
| Same tool exposed as MCP | `gpt-oss/gpt-oss-mcp-server/browser_server.py` | gpt-oss HEAD |

Trust notes. The definition text is exact because it is in code. The implementation, however, is explicitly educational: the README warns "This implementation is purely for educational purposes and should not be used in production. You should implement your own equivalent of the `YouComBackend` or `ExaBackend` class with your own browsing environment." So the *interface* (what the model was trained on) is authoritative, while the *backends* (Exa, You.com) are stand-ins for whatever OpenAI used in training. ChatGPT agent mode (2025) and Deep Research use the same interface and citation syntax (see `chatgpt.md`, section 4), which suggests this is the production design with the backend swapped out.

---

## 1. The tool definition (verbatim)

The model sees this in the system message under `# Tools` (from `harmony/test-data/test_browser_tool_only.txt`, the exact rendering produced by `ToolNamespaceConfig::browser()`):

~~~~
## browser

// Tool for browsing.
// The `cursor` appears in brackets before each browsing display: `[{cursor}]`.
// Cite information from the tool using the following format:
// `【{cursor}†L{line_start}(-L{line_end})?】`, for example: `【6†L9-L11】` or `【8†L3】`.
// Do not quote more than 10 words directly from the tool output.
// sources=web (default: web)
namespace browser {

// Searches for information related to `query` and displays `topn` results.
type search = (_: {
query: string,
topn?: number, // default: 10
source?: string,
}) => any;

// Opens the link `id` from the page indicated by `cursor` starting at line number `loc`, showing `num_lines` lines.
// Valid link ids are displayed with the formatting: `【{id}†.*】`.
// If `cursor` is not provided, the most recent page is implied.
// If `id` is a string, it is treated as a fully qualified URL associated with `source`.
// If `loc` is not provided, the viewport will be positioned at the beginning of the document or centered on the most relevant passage, if available.
// Use this function without `id` to scroll to a new location of an opened page.
type open = (_: {
id?: number | string, // default: -1
cursor?: number, // default: -1
loc?: number, // default: -1
num_lines?: number, // default: -1
view_source?: boolean, // default: false
source?: string,
}) => any;

// Finds exact matches of `pattern` in the current page, or the page given by `cursor`.
type find = (_: {
pattern: string,
cursor?: number, // default: -1
}) => any;

} // namespace browser

# Valid channels: analysis, commentary, final. Channel must be included for every message.<|end|><|start|>assistant
~~~~

The model calls a function by addressing a message to `browser.search`, `browser.open` or `browser.find` on the `analysis` channel, with a JSON argument object. From `harmony/docs/format.md`:

~~~~
If the model decides to call actions in the browser it will use the same format as for [function calls](#function-calling) with two notable exceptions:

1. Requests will be made to the `analysis` channel
2. The recipient will be `browser.search`, `browser.open`, `browser.find` respectively
~~~~

**Doc glitch.** The copy of the definition inside `docs/format.md` (lines 540–569) has a line `Reasoning: high` pasted where `source?: string,` belongs in the `open` type. The test fixture and `chat.rs` have the correct version quoted above.

The JSON-schema form in `harmony/src/chat.rs` (lines 259–309):

~~~~rust
    pub fn browser() -> Self {
        ToolNamespaceConfig::new(
            "browser",
            Some("Tool for browsing.\nThe `cursor` appears in brackets before each browsing display: `[{cursor}]`.\nCite information from the tool using the following format:\n`【{cursor}†L{line_start}(-L{line_end})?】`, for example: `【6†L9-L11】` or `【8†L3】`.\nDo not quote more than 10 words directly from the tool output.\nsources=web (default: web)".to_string()),
            vec![
                ToolDescription::new(
                    "search",
                    "Searches for information related to `query` and displays `topn` results.",
                    Some(serde_json::json!({
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "topn": {"type": "number", "default": 10},
                            "source": {"type": "string"}
                        },
                        "required": ["query"]
                    })),
                ),
                ToolDescription::new(
                    "open",
                    "Opens the link `id` from the page indicated by `cursor` starting at line number `loc`, showing `num_lines` lines.\nValid link ids are displayed with the formatting: `【{id}†.*】`.\nIf `cursor` is not provided, the most recent page is implied.\nIf `id` is a string, it is treated as a fully qualified URL associated with `source`.\nIf `loc` is not provided, the viewport will be positioned at the beginning of the document or centered on the most relevant passage, if available.\nUse this function without `id` to scroll to a new location of an opened page.",
                    Some(serde_json::json!({
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": ["number", "string"],
                                "default": -1
                            },
                            "cursor": {"type": "number", "default": -1},
                            "loc": {"type": "number", "default": -1},
                            "num_lines": {"type": "number", "default": -1},
                            "view_source": {"type": "boolean", "default": false},
                            "source": {"type": "string"}
                        }
                    })),
                ),
                ToolDescription::new(
                    "find",
                    "Finds exact matches of `pattern` in the current page, or the page given by `cursor`.",
                    Some(serde_json::json!({
                        "type": "object",
                        "properties": {
                            "pattern": {"type": "string"},
                            "cursor": {"type": "number", "default": -1}
                        },
                        "required": ["pattern"]
                    })),
                ),
            ],
        )
    }
~~~~

The MCP server (`gpt-oss-mcp-server/browser_server.py`) exposes the same three functions with the same descriptions and adds MCP titles: "Search for information", "Open a link or page", "Find pattern in page".

### Usage rules

There are no usage rules beyond the four lines in the namespace comment. Everything about when to search, how many times, and how to write queries was learned in training, not prompted:

~~~~text
Cite information from the tool using the following format:
`【{cursor}†L{line_start}(-L{line_end})?】`, for example: `【6†L9-L11】` or `【8†L3】`.
Do not quote more than 10 words directly from the tool output.
~~~~

The README describes the design intent in plain words (`gpt-oss/README.md` lines 495–501):

~~~~
```

#### Details

To control the context window size this tool uses a scrollable window of text that the model can interact with. So it might fetch the first 50 lines of a page and then scroll to the next 20 lines after that. The model has also been trained to then use citations from this tool in its answers.

To improve performance the tool caches requests so that the model can revisit a different part of a page without having to reload the page. For that reason you should create a new browser instance for every request.
~~~~

---

## 2. What the implementation does

All paths below are relative to `gpt-oss/gpt_oss/tools/simple_browser/`.

### Constants

| Constant | Value | Where | Meaning |
|---|---|---|---|
| `view_tokens` | 1024 | `simple_browser_tool.py:326` | Size of one page view. The window is cut after 1,024 tokens (o200k_base encoding) of line-numbered text. |
| `max_search_results` | 20 | `simple_browser_tool.py:324` | Results fetched per search. The model's `topn` argument is thrown away (`del topn`, line 463). |
| `ENC_NAME` | `"o200k_base"` | `simple_browser_tool.py:39` | Tokenizer used to size the view. |
| `wrap_lines(width=80)` | 80 characters | `simple_browser_tool.py:163` | Every page is hard-wrapped at 80 characters before line numbers are assigned. |
| `run_find_in_page(max_results=50, num_show_lines=4)` | 50 matches, 4 lines each | `simple_browser_tool.py:208–213` | `find` returns at most 50 hits, each showing the matching line plus the next 3. |
| scroll-back on open | 4 lines | `simple_browser_tool.py:527–533` | Opening a search or find hit positions the view 4 lines above the hit. |
| `maybe_truncate(num_chars=1024)` | 1,024 chars | `backend.py:74` | Truncates error messages and the URL in the page header. |

### How a search works (`search`, `simple_browser_tool.py:456–477`; backends in `backend.py`)

1. The backend calls the search API for 20 results. The Exa backend asks Exa for each result's text *and an LLM-written `summary`* (`backend.py:147`) and uses the summary as the snippet. The You.com backend uses You.com's own snippets, and also merges in news results (`backend.py:221–232`).
2. The backend builds a tiny HTML page, `<h1>Search Results</h1>` with one `<li><a href=url>title</a> snippet</li>` per result (`backend.py:154–161`), and runs it through the same HTML-to-text converter used for real pages.
3. So the search results page is just another page: it gets a cursor number, line numbers and link IDs, and it is shown through the same 1,024-token window.

### How pages are converted (`page_contents.py`)

- `process_html` (lines 253–304) is the pipeline. Links are rewritten first by `_clean_links` (lines 130–164): every `<a href>` becomes `【{link_id}†{anchor text}】` for same-domain links and `【{link_id}†{anchor text}†{domain}】` for other domains. Link IDs are numbered in order of first appearance, and a repeated URL reuses its ID. The model follows a link with `open(id=<link_id>)`.
- Images become `[Image {n}: {alt text}]` or `[Image {n}]` (lines 236–250). `<math>` elements are dropped (lines 209–212). arXiv links are rewritten to ar5iv (line 125–127).
- The page body is converted with `html2text` with links, images, tables and emphasis ignored and no wrapping (lines 185–206). `ignore_tables=True` means table cells come through as loose text without table structure.
- The characters `【` and `】` in the page are replaced with `〖` and `〗` (lines 105–115), so page text can never forge a link or citation marker.
- The backends pass `display_urls=True`, which puts a `URL: <url>` line at the top of every page (lines 293–295). Publication dates are not extracted ("NOTE: Publication date is currently not extracted due to performance costs.", line 296).

### How a page is shown (`show_page`, `simple_browser_tool.py:399–420`)

- The page text is wrapped at 80 characters and every line is prefixed with `L{n}: ` (lines 154–160).
- Starting at `loc`, the view takes as many lines as fit in `view_tokens` = 1,024 tokens, rounding up to a whole line (`get_end_loc`, lines 113–140). If the model passes `num_lines`, that overrides the token budget.
- The header is `[{cursor}] {title} ({url})` followed by a bold "scrollbar" line `**viewing lines [{start} - {end}] of {last_line}**` (lines 381–397 and 419).
- Every call (search, open, find) pushes a new entry on the page stack, so the cursor number grows by one on every call, even when scrolling within the same page (`add_page`, lines 287–289). Citations use this cursor number.

### How `open` works (`simple_browser_tool.py:481–534`)

- `open(id="https://…")` fetches a URL directly and always refetches (a direct URL open "should be regarded as a refresh", line 432).
- `open(id=3)` follows link 3 on the current page, or on the page named by `cursor`. Pages already fetched in this session are served from the cache (lines 429–435), which is why the README says to create a new browser instance per request.
- `open()` with no `id` but with `loc` scrolls the current page.
- When the link comes from a search or find results page that stored a snippet with a line index, the view opens 4 lines above that line (lines 527–533). In this implementation only `find` stores line indices, so "centered on the most relevant passage" in the tool description only happens when opening a `find` hit. Opening a search result starts at line 0.

### How `find` works (`run_find_in_page`, `simple_browser_tool.py:208–255`; `find`, lines 538–550)

- Matching is a plain case-insensitive substring test on each 80-character wrapped line (`pattern not in line.lower()`, line 223). There is no regex and no fuzzy matching, and a phrase that is split across a line break is not found.
- Links are stripped to their anchor text before matching (line 216), so a phrase that contains link text is still found.
- Each hit shows the matching line and the 3 lines after it (not before it), headed by `# 【{k}†match at L{line}】`. After a hit, the scan skips ahead 4 lines, so two matches within 4 lines are reported as one.
- The results are again a page with its own cursor, and `open(id=k, cursor=<find page>)` jumps to the hit on the original page. If nothing matches, the page says ``No `find` results for pattern: `{pattern}` ``.
- `find` refuses to run on a find results page ("Cannot run `find` on search results page or find results page", line 542). The check is `page.snippets is not None`, and search results pages built by the Exa and You.com backends have no snippets, so in practice `find` *does* run on search results pages.

### How citations are turned into links (`normalize_citations`, `simple_browser_tool.py:620–695`)

The model writes `【{cursor}†L{a}-L{b}】`. The Responses API server (`gpt_oss/responses_api/api_server.py:286`) rewrites each one to ` ([domain](url)) ` using the page stack, and returns an annotation `{type: "url_citation", url, title: domain, start_index, end_index}`. The line range is used by the model to say *where* in the page the evidence is, but this implementation throws it away when rendering; only the page URL survives.

---

## 3. What the model sees: a real run

I ran the actual `SimpleBrowserTool` code with a stub backend (search returns two fixed results; every fetch returns the same 40-paragraph test article). The script is `scratchpad/gptoss_demo.py`. Output below is unedited except that long outputs are cut where marked.

`browser.search({"query": "measles cases 2025 CDC"})`:

~~~~text
[0] measles cases 2025 CDC
**viewing lines [0 - 7] of 7**

L0: 
L1: URL: 
L2: # Search Results
L3: 
L4:   * 【0†CDC measles cases and outbreaks†www.cdc.gov】 As of March 2025, a total of
L5:  301 confirmed measles cases were reported by 15 jurisdictions.
L6:   * 【1†Measles outbreak in Texas - Wikipedia†en.wikipedia.org】 The 2025 Texas 
L7: measles outbreak is an ongoing outbreak of measles centered in Gaines County.
~~~~

`browser.open({"id": 0})` (follow result 0; the window stops after 1,024 tokens, which was 62 lines here):

~~~~text
[1] Measles cases rise in 2025 (https://www.cdc.gov/measles/data-research/index.html)
**viewing lines [0 - 61] of 162**

L0: 
L1: URL: https://www.cdc.gov/measles/data-research/index.html
L2: # Measles cases rise in 2025 
L3: 
L4: Paragraph 0. The CDC reported that measles cases in the United States reached a 
L5: record number this year, according to 【0†CDC data】 and a 【1†local note】. 
L6: Officials said vaccination rates in some counties fell below 90 percent.
L7: 
L8: Paragraph 1. The CDC reported that measles cases in the United States reached a 
…  (continues to L61)
~~~~

`browser.find({"pattern": "90 percent"})`:

~~~~text
[2] Find results for text: `90 percent` in `Measles cases rise in 2025` (https://www.cdc.gov/measles/data-research/index.html/find?pattern=90 percent)
**viewing lines [0 - 81] of 235**

L0: # 【0†match at L6】
L1: Officials said vaccination rates in some counties fell below 90 percent.
L2: 
L3: Paragraph 1. The CDC reported that measles cases in the United States reached a 
L4: record number this year, according to CDC data and a local note. 
L5: 
L6: # 【1†match at L10】
L7: Officials said vaccination rates in some counties fell below 90 percent.
…
~~~~

`browser.open({"id": 3, "cursor": 2})` (jump to find hit 3, which was at L18; the view opens at L14):

~~~~text
[3] Measles cases rise in 2025 (https://www.cdc.gov/measles/data-research/index.html)
**viewing lines [14 - 74] of 162**

L14: Officials said vaccination rates in some counties fell below 90 percent.
L15: 
L16: Paragraph 3. The CDC reported that measles cases in the United States reached a 
L17: record number this year, according to 【0†CDC data】 and a 【1†local note】. 
L18: Officials said vaccination rates in some counties fell below 90 percent.
…
~~~~

A citation of the vaccination sentence would be written `【3†L18】` (cursor 3, line 18), or `【1†L4-L6】` for the first paragraph from the first view.

---

## 4. Comparison with our tools, in plain words

- Our `web_fetch` hands the model the first 20,000 characters of a page at once. The gpt-oss browser hands it about 1,024 tokens (roughly 4,000 characters, about 60 wrapped lines) at a time, with a scrollbar line telling it how long the page is, and lets it scroll with `loc`, jump with `find`, and follow numbered links. The page is fetched once and cached, so scrolling and finding cost no extra fetches.
- Our `google_search` returns 10 results with Serper's snippets. The gpt-oss search returns 20 results, shown in the same line-numbered window, and with Exa the snippet is an LLM summary of the page rather than a search-engine extract.
- Citations name a page view and a line range rather than a URL, and the harness maps them back to URLs. That makes the model point to the exact lines that support a claim, which is close to what our source verifier wants in its "verbatim supporting quote".
- The 10-word quote limit is the only quoting rule, and it is about copyright, not about verification.
