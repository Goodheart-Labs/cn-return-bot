# Which tools agent harnesses give the model, compared with our two

Research for GOO-166, written 2026-09-23. This is the answer to Jim's question about tools. `AGENT_SDKS.md` covers the loop around the tools; this document covers the tools themselves: what each system hands the model, exactly how it is described, what happens when the model calls it, and what comes back.

The raw material is in `tool_definitions/`: 22 files, one per system, with every tool's description and parameters quoted verbatim as the model sees them, plus what the implementation does, with file and line references. Sources and how far to trust them:

- **Read from source code:** Claude Code (from the compiled binary), Codex, Gemini CLI, OpenHands, smolagents, LangChain Deep Agents, Strands, Pydantic AI, Google ADK, Mastra, the Vercel AI SDK, OpenRouter's SDKs, and OpenAI's gpt-oss browser tool. The gpt-oss browser was also run against a stub backend, so its example output below is real.
- **From official docs:** the hosted tools of Anthropic, OpenAI, Google, Perplexity and xAI. Most vendors do not publish the text their model sees for hosted tools.
- **Echoed by the model:** for OpenRouter and Grok, a model was asked to print back the tool definitions it had been given, for about $0.20.
- **From leaked system prompts:** ChatGPT, Claude.ai, Grok, Perplexity, Gemini, Meta AI, Manus, Cursor, Windsurf, Kimi, Mistral, Qwen, Copilot. Leaks are of uncertain date and accuracy, and several lost their citation markers to character encoding. Each file says which.

## Summary

Our model gets two tools. `google_search` takes one query and returns ten titles, URLs and two-line snippets. `web_fetch` takes a URL and returns the page as markdown, cut at the first 20,000 characters, with no way to see the rest. Compared with the 30-odd systems read here, that is the thinnest tool set of any research harness, and the page reader is the weakest design in the set.

Five things other systems give their model that ours lacks, in order of how much they would matter for fact-checking with a cheap model:

1. **A way to read the part of a page that matters.** Every serious design lets the model reach any part of a long page: a numbered window it can move plus a find command (OpenAI's browser lineage, which Meta's Muse Spark harness copies), a saved result it can page and grep through (Deep Agents, Strands, Mastra, OpenHands), passages picked for the query (Exa, Perplexity, Grok), or code that filters the page before it enters the context (Anthropic, Codex). Ours shows the first 20,000 characters and nothing else.
2. **Several queries per search call, with a date filter.** ChatGPT (up to 4), Perplexity (3 to 5), Gemini, Kimi and Meta's Muse Spark harness take several queries at once. Most take a recency or date filter. Ours takes one query and no filter, and our logs show the model writing "September 2026" into the query text instead.
3. **Line-addressed citations or guaranteed quotes.** OpenAI's browser cites line ranges (`【3†L18】`). Anthropic's `web_fetch` citations carry exact character positions, so the quoted text is guaranteed to exist in the source. Our verifier has to check quotes after the fact.
4. **A tool description that says what the tool can do.** ChatGPT and Codex put the search rules inside the tool description: when to search, how to quote, when to open the page. Our descriptions are one sentence each, and our search prompts tell the model to "Use the web_search tool" while the tool in the Serper loop is called `google_search`. The model learns that `web_fetch` exists only from its one-line description.
5. **Page history.** smolagents has `find_archived_url(url, date)`, which opens the Wayback Machine copy of a page closest to a date. For checking a claim against the page as it stood when the claim was made, nothing else offers this.

The most relevant single finding: **Muse Spark, our main model, is served by Meta with a copy of OpenAI's browser tool** (leaked Meta AI prompt, July 2026). Its search takes a primary query plus alternative queries and a `since` date; its `open` shows a numbered window of the page centred on the most relevant passage; its `find` returns matches in the page; citations point at line numbers. Whether the Muse Spark 1.3 Contributor model we call through OpenRouter was trained with exactly these tools is unverified, but it is likely used to this shape, not to ours.

Section 8 proposes a concrete tool set for us.

## 1. Our two tools, verbatim

```json
{ "name": "google_search",
  "description": "Search Google for web pages matching a query. Returns titles, URLs, and snippets.",
  "parameters": { "query": { "type": "string", "description": "The Google search query." } } }
```

```json
{ "name": "web_fetch",
  "description": "Fetch a URL and extract its main content as markdown.",
  "parameters": { "url": { "type": "string", "description": "The URL to fetch." } } }
```

What comes back:
- `google_search` sends `{q, num: 10}` to Serper and returns a numbered list of title, date if any, URL and snippet. Everything else Serper returns (the answer box, the knowledge panel, news results) is dropped.
- `web_fetch` walks our fetch ladder and returns the first 20,000 characters of the page's markdown. When it cuts, it says nothing. When it falls back to an archive or a headless browser, it prepends one line saying so.

What the prompts say about them:
- The X search prompt and the claim-check prompt both say "Use the web_search tool to find evidence." That wording was written for the provider-native arms. In the Serper loop the tool is `google_search`, and the loop appends: "You have access to a google_search tool. Issue search queries to gather evidence, then return your final findings as JSON." `web_fetch` is never mentioned.
- The Common Notes rater's prompt is the only one that explains both tools: "Use google_search to find sources… and web_fetch to read the most relevant pages in full. Related claims usually share a source, so read the few pages that settle many claims at once."

## 2. The whole landscape in one table

Search columns: how many queries one call takes, whether the model can filter by date or domain, and what a result contains. Reading columns: how the model gets page text. "Hosted" means the tool runs on the vendor's servers.

| System | Queries per call | Date filter | Domain filter | A search result is | How the model reads a page | Find in page | Citation mechanism |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Ours** | 1 | no | no (operators work but are never mentioned) | title, URL, ~160-char snippet | first 20,000 chars | no | URL in prose |
| ChatGPT (leak) | up to 4 | recency in days | yes | result with id `turn2search5` | open at a line, click links, screenshot PDF pages | yes | `【cite\|turn2search5】`, 25-word quote cap per source |
| gpt-oss browser (code) | 1 | no | no | search results page, 20 results | 1,024-token window of numbered lines | yes, 50 matches with context | `【cursor†L9-L11】` line ranges |
| Meta AI, Muse Spark (leak) | primary plus alternatives | `since` date | no | as gpt-oss | numbered window, centred on the most relevant passage | yes | line numbers |
| Codex `web.run` (code) | up to 4 | recency | yes | server-formatted text, ids | open at a line, click, find, PDF screenshot | yes | markdown links; 25-word quote cap |
| Claude Code (code) | 1 | no | yes | titles and URLs only, plus a nested model's text | a small model answers a question about the first 100,000 chars; main model never sees the page | no | "MUST include the sources" |
| Claude.ai (leak) | 1 | no | no | top 10 results | whole page | no | sentence-index cite tags; quotes under 15 words |
| Anthropic API `web_search` / `web_fetch` (docs) | 1 | no | yes (developer sets) | url, title, page age, encrypted snippet | whole page up to `max_content_tokens`; newer versions filter it in a code sandbox | via code | citations with exact character positions, guaranteed real |
| OpenAI Responses `web_search` (docs) | not public | no | yes (developer sets) | not returned to the caller | hidden actions `open_page`, `find_in_page` | yes, hidden | `url_citation` spans, no quote |
| Gemini CLI (code) | 1 | no | no | a Flash-written answer with `[n]` markers | Flash reads up to 20 URLs and answers | no | from grounding metadata |
| Gemini app (leak) | several | no | no | snippets | no page reader at all | no | `[INDEX]` |
| Grok (leak and model echo) | 1 | no (X search has dates) | no | up to 30 results, passages prefixed with line numbers (`L81:`) | `browse_page(url, instructions)`: a second model summarises | no | `render_inline_citation` |
| Perplexity Agent API (docs) | several | recency and before/after dates | 20 domains | snippets up to a per-page token budget, publish and update dates | `fetch_url` returns extracts, up to 10 URLs | no | `[web:N]`, `[page:N]` |
| OpenRouter server tools (docs and echo) | 1, described as "put every criterion into ONE query" | no | yes | url, title, Exa-picked passages | `web_fetch`; the free engine returned raw HTML in probes | no | `url_citation` |
| Windsurf (leak) | 1 | no | no | snippets | page split into chunks, read chunk by chunk | no | none |
| Manus (leak) | 1, 3 to 5 keywords | date range | no | snippets, "not valid sources" | a real browser, markdown extracts | no | none |
| smolagents (code) | 1 | `filter_year` (Serper tool) | no | markdown list of title, URL, snippet, date | `visit_webpage` cuts at 40,000 chars; the research browser pages in ~8,000-char chunks | yes (`find_on_page_ctrl_f`, `find_next`) | none |
| Deep Agents (code) | no web tools | | | | large results saved to a file; `read_file` 100 lines at a time; `grep` | yes, `grep` | prompt text only |
| Strands (code) | 1 (Tavily and Exa tools take 18 to 25 parameters) | yes | yes | raw provider response | an analyst model answers from the first 50,000 chars; offloaded results can be regex-searched | yes, on offloaded results | none |
| OpenHands (code) | no search for the main agent | | | | `browser_get_content` in 30,000-char pieces with `start_from_char` | no | none |
| Mastra (code) | via provider or Parallel | yes (Parallel) | | excerpts chosen for a stated goal | `recall` skims, then opens a part, continues from `nextCharOffset` | | none |

## 3. Search tools

**Inputs.** Three shapes exist.
- **One query string**, like ours: Claude Code, Claude.ai, Anthropic API, Grok, OpenRouter, Gemini CLI, Windsurf, Manus.
- **A batch of queries**: ChatGPT and Codex take up to 4 per call, Perplexity 3 to 5, Gemini and Kimi an array. Meta's `browser.search` takes a `primary_query` plus `alternative_queries`, each with a language code, and its description says when to add them: "when you want to search for content in multiple ways… It is not helpful to repeat the primary query with trivial rewording… if content is likely to be found in a different language, add a translated alternative query".
- **A goal plus keywords**: Parallel takes an `objective` in prose (up to 5,000 characters) plus keyword queries, and Exa takes a separate query for picking passages. For us the claim itself would be the objective.

**Date handling** splits two ways. Meta's description: "Do not add absolute years, dates, or times unless searching for an entity that needs a date to be identified. Do not include relative time phrases like 'latest' in this field, use the `since` field". Mistral says the same. Gemini, Kimi and Copilot instead tell the model to put the year in the query. ChatGPT has a recency filter in days with rules: 1 for breaking news, 7 for "this week", 30 for "this month". Ours has neither, and 36% of the X pipeline's queries carry a year.

**What a result contains** ranges from almost nothing to whole passages.
- Titles and URLs only: Claude Code's main model.
- Snippets: ours, Claude.ai, Gemini app, Manus, smolagents.
- Passages chosen for the query: Exa through OpenRouter, Perplexity (with a per-page token budget of 300, 1,000 or 4,000), Grok (passages with line numbers), Parallel.
- A written answer instead of results: Gemini CLI, Google ADK, and effectively Claude Code.

**Query-style rules conflict.** Perplexity's presets: "plain keywords. Never use quotation marks, AND, OR, or NOT", 2 to 5 words. Claude.ai: 1 to 6 words, broad first, no operators unless asked. OpenRouter's description: put every criterion into one query. Manus: 3 to 5 keywords, one attribute of an entity per search. Perplexity Computer (May 2026): "natural phrases, not keyword lists". No one has evidence for their choice. For us one point is clear: Serper passes Google's operators through, and Perplexity's own engine does not, so Perplexity's no-operators rule is about their engine, not a general truth.

**Rules about searching that suit fact-checking.**
- Search "the assumption itself" before relying on it (ChatGPT, Kimi).
- Use searches "to rule the alternatives in or out … rather than only gathering more support for the one you currently favor" (Claude.ai).
- When sources disagree, cite one high-quality source per viewpoint (ChatGPT, Copilot).
- "Snippets in search results are not valid sources; must access original pages" (Manus). xAI's official fact-check bot rule: "You must use the browse page to verify all points of information you get from search."
- If nothing is found, say what was found and why it was not enough (ChatGPT).

## 4. Reading pages: the four designs

**A. The whole page, cut at a size.** Claude.ai, the Anthropic API `web_fetch` (developer sets `max_content_tokens`), smolagents `visit_webpage` (40,000), Pydantic AI (50,000), Firecrawl's tool (80,000, ending `[Truncated: N characters total.]`), Mastra (100,000, and it returns raw HTML despite saying "text content"), and ours (20,000, silent). Verbatim, simple, but anything past the cut is invisible and the whole page is re-billed every later turn.

**B. A window the model can move, plus find.** This is OpenAI's design from WebGPT (2021) through ChatGPT, Codex and the open-source gpt-oss browser, and Meta copies it. The page is cached as numbered lines; `open` shows a window; `find` lists matches; `open` at a match line jumps there. Real output of the gpt-oss browser:

```text
[1] Measles cases rise in 2025 (https://www.cdc.gov/measles/data-research/index.html)
**viewing lines [0 - 61] of 162**

L0:
L1: URL: https://www.cdc.gov/measles/data-research/index.html
L2: # Measles cases rise in 2025
L4: Paragraph 0. The CDC reported that measles cases in the United States reached a
L5: record number this year, according to 【0†CDC data】 and a 【1†local note】.
L6: Officials said vaccination rates in some counties fell below 90 percent.
```

```text
[2] Find results for text: `90 percent` in `Measles cases rise in 2025`
**viewing lines [0 - 81] of 235**

L0: # 【0†match at L6】
L1: Officials said vaccination rates in some counties fell below 90 percent.
```

The header always says how much of the page exists. A citation such as `【3†L18】` names a line, so it can be checked mechanically. Meta's `browser.open` adds one refinement: "If `line_start` is not provided, the viewport will be positioned at the beginning of the document or centered on the most relevant passage, if available."

Close relatives: smolagents' research browser (8,000-character pages, `page_up`, `page_down`, `find_on_page_ctrl_f`, `find_next`, headed "Showing page N of M"), OpenHands' `browser_get_content` (30,000-character pieces, each ending with the offset to ask for next), Windsurf's `view_content_chunk`, and the MCP reference `fetch` server (`start_index`, `max_length`, no find).

**C. Save the result and let the model page and grep it.** Deep Agents replaces any result over about 80,000 characters with: "Tool result too large, the result of this tool call {tool_call_id} was saved in the filesystem at this path: {file_path}", plus the first and last 5 lines; the model then uses `read_file` (100 lines, headed `lines 101-200 of 823 | next offset 200`) and `grep`. Strands' offloader and Mastra's `recall` do the same with their own tools, and Claude Code does it for any result over 50,000 characters. This is design B built from general file tools instead of a browser.

**D. A second model reads the page.** The main model passes a URL and a question and gets back an answer, never the page. Claude Code's `WebFetch` (Haiku reads up to 100,000 characters, told to "Enforce a strict 125-character maximum for quotes"), Gemini CLI's `web_fetch` (Flash with Google's URL context), Grok's `browse_page(url, instructions)`, Strands' default `web_fetch`, Qwen's `web_extractor(urls, goal)`, and Perplexity's `fetch_url` extracts. It saves context and tokens, but a paraphrase cannot supply a verbatim supporting quote, and the reader model can be wrong without the main model knowing.

Claude Code has a hidden variant, off by default, that points where Anthropic may be heading: its `web-fetch` subagent receives the page verbatim up to about 48,000 characters, and a labelled summary of the rest, with the instructions "Quote exact snippets … verbatim", "Include the final URL(s) you actually read", "Do not fill gaps from memory".

**E. Filter the page in code.** Anthropic's newer `web_search` and `web_fetch` versions run inside a code sandbox: the model calls them as Python functions, filters the text with Python or ripgrep, and only what it prints enters its context. Anthropic reports 11% better accuracy with 24% fewer input tokens on its search benchmarks. Codex's "code mode" does the same with JavaScript: most Codex models see only an `exec` tool, and `web.run` is a function inside it. This is the most powerful design and the least suitable for a cheap model, which writes worse code.

For fact-checking, design D is ruled out because the verifier needs quotes. Design E needs a stronger model than Muse. Designs B and C both keep the text verbatim and make all of it reachable; B is what Muse's own harness uses.

## 5. Quotes and citations

- **Guaranteed quotes:** only Anthropic's `web_fetch` with citations on. Each citation carries character positions in the fetched document, and the quoted text is taken from the document, so it cannot be invented. This is what our `verifier_citations` step checks after the fact.
- **Line-addressed citations:** the OpenAI browser lineage and Meta. A citation names a page view and line range, so a harness can check the quote against those lines.
- **Quote caps as prompt rules:** ChatGPT and Codex 25 words per source with a paraphrase cap `[wordlim N]`, Claude.ai under 15 words and one quote per source, gpt-oss 10 words, Perplexity 30 words. These are copyright rules for consumer products and do not apply to us.
- **Nothing:** most libraries leave citations to the prompt.

## 6. The other tool families

**Final-answer tools.** A tool whose arguments are the output schema, validated, with errors sent back: smolagents `final_answer`, Pydantic AI `final_result`, Claude Code `StructuredOutput` (5 attempts), Gemini CLI `complete_task`, Google ADK `set_model_response`, OpenHands `finish`. For us this matters mainly because the providers that refuse `tool_choice: "required"` also make constrained JSON unreliable when tools are present.

**Think and plan tools are mostly no-ops.** OpenHands `think` replies "Your thought has been logged." Codex `update_plan` replies "Plan updated" and the model never sees the plan again. Claude Code's `TodoWrite` replies with fixed text. LangChain's example researcher has a `think_tool` that only records the reflection. They work by giving the model a place to write, not by doing anything. Strands' `think` is the exception: it runs nested agents.

**Budget and time.** Almost no system tells the model its remaining budget. Limits are enforced silently and the model learns of them from an error: Anthropic's `max_uses`, OpenRouter's "Search limit reached", Claude Code's 200-search session cap. The exceptions are smolagents' planning turns ("N steps remaining") and Codex's flagged `get_context_remaining`. The current date is usually injected as text, not a tool. Our Common Notes rater already returns "search budget spent, rate with what you have", which is as good as anything here.

**Page history.** smolagents' `find_archived_url(url, date)` opens the Wayback snapshot closest to a date. Our fetch ladder uses Wayback only as a fallback when the live page fails, never on the model's request.

**Tools that do not do what they say.** Mastra's `web_fetch` promises "text content" and returns raw HTML. OpenRouter's free `openrouter` fetch engine returned raw HTML in both probes. Google ADK's `load_web_page` fails on any redirect. Grok returned an empty page for a JavaScript-heavy site without an error. OpenHands' research prompt names a tool `tavily_search` that is actually `tavily-search`. Our own prompts name `web_search` for a tool called `google_search`. Mismatches between description and behaviour are common enough to be worth testing for.

## 7. Muse Spark's native tools

Muse Spark 1.3 Contributor runs every step of the Common Notes pipeline. Two leaks of Meta AI's own harness for Muse Spark (one undated, one stating 2026-07-12) show its tools. Full text in `tool_definitions/other_products.md`, section 7.

- `browser.search`: `primary_query` and `alternative_queries`, each `{query, language_code}`; `since` (a date, "Set only when the user explicitly requests a timeframe or recency constraint"); `verticals` (at most one of news, sports, weather, finance, datetime, local); `verbosity_level`.
- `browser.open`: `url_id` (a search result page id or a URL), `outlink_idx`, `line_start`. Without `line_start`, the view is centred on the most relevant passage.
- `browser.find`: exact matches of a pattern in a page.
- `browser.lookup_citation_url`: turns result ids into real URLs.
- Citations: `【{url_id}†L{line}】`.

Two caveats. This is Meta's consumer app, not the OpenRouter endpoint we call, and a leak. And training on a tool shape does not guarantee the model uses a differently named copy well. It is still the strongest hint available about which tool shape our model handles best, and it costs one A/B arm to test.

## 8. A proposed tool set for us

This is a proposal to discuss, not a decision. It keeps the fetch ladder and Serper underneath, and changes only what the model sees.

1. **`search`**, replacing `google_search`. Parameters: `queries` (1 to 4 strings, run in parallel against Serper), optional `since` (a date, sent as Google's time filter), optional `site`. Results keep Serper's snippets and dates, add the answer box when there is one, and give each result a short id. The description states that exact phrases in quotation marks and `site:` work, and that dates go in `since`, not in the query.
2. **`open`**, replacing `web_fetch`. Parameters: `url` or a result id, optional `line`, optional `looking_for` (a few words). The page is fetched once per run through the existing ladder and cached as numbered lines. The reply shows a window of about 6,000 characters with a header "lines X to Y of Z". With `looking_for`, the window is centred on the best lexical match, which is Meta's "centered on the most relevant passage". A second `open` of the same URL costs nothing.
3. **`find`**. Parameters: `url` or result id, `pattern`. Case- and punctuation-insensitive exact matching over the cached lines, at most 20 matches with two lines of context, "use a more specific phrase" above that. No regex.
4. **Quotes checked by the harness.** The verifier answers with a URL, a quote and a line range; the harness checks the quote against those lines before accepting it. This gives us what Anthropic's citations guarantee, without a model call.
5. **Optionally, `archived(url, date)`** for a claim about what a page said at a given time, using the Wayback lookup the ladder already has.
6. **Prompt fixes that need no new tool:** name the tools the loop actually provides, describe both of them, and add the fact-checking rules from section 3 (search the assumption itself, rule alternatives out, open the page rather than trusting a snippet).

How to judge it: an A/B arm against the current tools on the Common Notes claim checks, measuring verifier acceptance, quotes that anchor, tokens per check, and turns per check. A second arm could mirror Meta's names and shapes exactly (`browser.search` with `primary_query` and `alternative_queries`, `browser.open`, `browser.find`) to test whether Muse does better with its native tool shape.
