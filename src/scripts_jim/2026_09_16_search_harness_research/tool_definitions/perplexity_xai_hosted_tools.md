# Perplexity and xAI hosted tools (plus Exa and Firecrawl agent tools)

This file covers three families:

1. **Perplexity Agent API** built-in tools `web_search` and `fetch_url`. Perplexity runs the whole agent loop on its servers. You send a request with `tools: [{type:"web_search"}, {type:"fetch_url"}]` (or a `preset`), and you get back the final answer plus `search_results` / `fetch_url_results` items.
2. **xAI (Grok) server-side tools** `web_search` and `x_search`. Same pattern: xAI runs the loop. One configured tool expands into several model-facing functions (`web_search`, `browse_page`, `x_keyword_search`, and so on).
3. **Exa and Firecrawl** client-side tool helpers. These are function tools that run in your own process and call the vendor's API.

Sources:

- `sdks/perplexity-py` (Stainless-generated SDK: `src/perplexity/types/response_create_params.py`, `types/output_item.py`, `generated/api.py`).
- Perplexity docs, fetched as markdown on 2026-09-23: `docs/agent-api/tools/web-search.md`, `tools/fetch-url-content.md`, `presets.md` (which publishes every preset's full system prompt), `building-agents/give-it-tools.md`.
- `sdks/xai-sdk-python/src/xai_sdk/tools.py` and `chat.py`.
- xAI docs, fetched 2026-09-23: `docs.x.ai/developers/tools/{overview,web-search,x-search,citations,tool-usage-details}.md`.
- Leaked Grok consumer system prompts: `sdks/system_prompts_leaks/xAI/grok-4.6.md` and `sdks/leaked-system-prompts/xAI-grok4.20_20260217.md`.
- **Live probe** of the xAI API (my own, 2026-09-23, `grok-4.20-0309-non-reasoning` on `/v1/responses` with `XAI_API_KEY`). I asked Grok to print its tool definitions, then to run one search and one browse and echo the raw results. The definitions it printed match the leaked consumer prompt word for word (except one garbled line, noted below), so I treat the leaked text as the verbatim source and the probe as confirmation that the API uses the same tools. I had no Perplexity key, so nothing Perplexity-side was probed.
- `sdks/exa-js/src/tools/core.ts`; `sdks/firecrawl/apps/php-sdk/src/Laravel/Tools/*.php`.

## Index

| System | Tool | Where it runs | Model fills in | Model gets back |
|---|---|---|---|---|
| Perplexity | `web_search` | Perplexity server | not public (docs imply several queries per call) | ranked results with `id`, title, URL, snippet, dates; cite as `[web:N]` |
| Perplexity | `fetch_url` | Perplexity server | not public (URLs, up to `max_urls`) | extracted page "snippet" per URL; internally uses grep and LLM extraction (preset notes) |
| xAI | `web_search` (config) → `web_search` function | xAI server | `query`, `num_results` (default 10, max 30) | per result `[web:N] title - url`, `Published:`, then **line-numbered excerpts** `L14: ...` |
| xAI | `web_search` (config) → `browse_page` function | xAI server, **with an LLM summarizer** | `url`, `instructions` | the summarizer's answer to the instructions |
| xAI | (docs names only) `web_search_with_snippets`, `open_page`, `open_page_with_find` | xAI server | not visible | not visible |
| xAI | `x_search` (config) → `x_keyword_search`, `x_semantic_search`, `x_user_search`, `x_thread_fetch` | xAI server | query + filters | X posts; cite as `[post:N]` |
| xAI | `render_inline_citation` | a "render component" in the final answer | `citation_id` | nothing (rendered by the client) |
| Exa | `web_search` | your process → Exa API | `query` | text blocks: Title/URL/Published/Author/Highlights |
| Exa | `get_contents` | your process → Exa API | `urls[]` | same block format with page text |
| Firecrawl | `firecrawl_search`, `firecrawl_scrape` | your process → Firecrawl API | `query`, `limit` / `url` | JSON `{title,url,description}` list / markdown cut at 80,000 chars |

---

# Part 1. Perplexity Agent API

The Agent API is Perplexity's multi-provider "responses"-style endpoint (`POST /v1/responses` in the SDK). It runs models from several vendors (the presets currently use `openai/gpt-5.6-luna` and `openai/gpt-5.6-sol`) inside Perplexity's own loop with Perplexity's tools. The loop is bounded by `max_steps` (SDK docstring, `response_create_params.py:54`: "Maximum number of research loop steps. If provided, overrides the preset's max_steps value. Must be >= 1 if specified. Maximum allowed is 100.").

**The model-facing tool descriptions and argument schemas are not public** for either tool. What follows is the developer-facing configuration, the documented behaviour, and the system prompts Perplexity publishes for its presets, which tell the model how to use the tools.

## 1.1 `web_search`

**Where it runs:** Perplexity's server, against Perplexity's own search index.

**Description:** not public. Docs overview, verbatim: "The `web_search` tool lets the model search the web during an Agent API request. Use it for current information, recent news, source-grounded research, and questions that need information beyond the model's training data."

**Model-facing arguments:** not public. Two pieces of evidence suggest the model sends a list of queries per call: the docs say "with several reformulated queries the budget is split per query (roughly `ceil(max_results / number_of_queries)`)", and the documented `search_results` output item carries `queries: [...]` (one example in the fetch-url page shows three queries in one item: "Bayes theorem medical test example", "Bayes rule disease test sensitivity specificity", "Bayesian inference prior posterior example disease test"). This is inferred.

**Developer configuration** (`ToolWebSearchTool`, `response_create_params.py:192`, and the docs "Parameters" table, verbatim):

| Parameter | Type | Description |
|---|---|---|
| `type` | string | Must be `"web_search"`. |
| `search_context_size` | string | Recommended token budget: `"low"`, `"medium"`, or `"high"`. |
| `filters` | object | Domain, date, recency, and location filters. |
| `user_location` | object | Location context for search personalization. |
| `max_results` | integer | Upper bound on results collected per call (1-50). |
| `max_tokens` | integer | Maximum total tokens for search context. |
| `max_tokens_per_page` | integer | Maximum tokens extracted from each search result page. |

`search_context_size` maps to budgets: `low` = 300 / 300 tokens (`max_tokens` / `max_tokens_per_page`), `medium` = 1,000 / 1,000, `high` = 4,000 / 4,000. Filters (inside `filters`): `search_domain_filter` (up to 20 domains or URLs, prefix `-` to exclude), `search_recency_filter` (`hour`, `day`, `week`, `month`, `year`), `search_after_date_filter` / `search_before_date_filter` (publication date, `MM/DD/YYYY`), `last_updated_after_filter` / `last_updated_before_filter`.

**What happens when called:** Perplexity searches, extracts page content up to the token budgets, and gives the model the results. Pricing $2.50 per 1,000 invocations. The API caller sees a `search_results` output item. Each result has, verbatim from the docs table:

| Field | Description |
|---|---|
| `id` | Stable index used to reference the result in citations. |
| `url` | Canonical URL of the source page. |
| `title` | Page title as returned by the source. |
| `snippet` | Excerpted text extracted from the page during search. |
| `date` | Date the page was originally published, in `YYYY-MM-DD` format. |
| `last_updated` | Date the page was last updated, in `YYYY-MM-DD` format. |
| `source` | Origin of the result (for example, `"web"`). |

Example from the docs (shortened to two results; note that many snippets in the docs' examples are empty strings, apparently when the token budget is used up by other results):

```json
{
  "results": [
    {
      "snippet": "CUDA is a parallel computing platform and programming model developed by NVIDIA that enables dramatic increases in computing performance by harnessing the power of the GPU.\nIt allows developers to accelerate compute-intensive applications and is widely used in fields such as deep learning, scientific computing, and high-performance computing (HPC).",
      "title": "CUDA Programming Guide",
      "url": "https://docs.nvidia.com/cuda/cuda-programming-guide/index.html",
      "date": "2026-03-04",
      "last_updated": "2026-05-02"
    },
    {
      "snippet": "",
      "title": "CUDA C++ Programming Guide - NVIDIA Documentation Hub",
      "url": "https://docs.nvidia.com/cuda/cuda-c-programming-guide/",
      "date": "2026-04-02",
      "last_updated": "2026-05-21"
    }
  ]
}
```

Snippets are multi-line extracts with `...` between non-adjacent passages, for example `"GPU (Graphics Processing Unit) architecture is ...\n...\nGPUs excel in executing thousands of parallel operations, ..."`.

**Citations.** In the model's context the results carry ids of the form `type:index`; the model cites them as `[web:1]`. The docs example answer text reads "... produce a posterior belief. [web:2]". The docs, verbatim: "treat the `id` and `url` fields of each `search_results` entry as the source of truth for citations."

## 1.2 `fetch_url`

**Where it runs:** Perplexity's server.

**Description:** not public. Docs, verbatim: "The `fetch_url` tool fetches and extracts content from specific URLs during an Agent API request. Use it when your application already knows which page, article, document, or report the model should inspect."

**Developer configuration** (`ToolFetchURLTool`, `response_create_params.py:211`):

| Parameter | Type | Description (verbatim) |
|---|---|---|
| `type` | string | Must be `"fetch_url"`. |
| `max_urls` | integer | Maximum number of URLs to fetch per tool call. The API schema allows values from 1 to 10. |

So one call can fetch several URLs (the model-facing argument is presumably a URL list; inferred). All the Perplexity research presets set `max_urls: 1`.

**What happens when called.** The API caller sees a `fetch_url_results` item with `contents: [{url, title, snippet}]` (`output_item.py:58-74`; field doc for `snippet`: "The fetched content snippet"). Docs, verbatim: "Fetched content is extracted into snippets for model context and may be truncated for longer pages." Failures are markers inside `snippet` ("an HTTP client error, a robots-policy block, or rate limiting"), and a URL with no upstream answer gets a snippet containing `no_result_returned`. Redirects are followed but `url` shows the requested URL. Pricing $0.50 per 1,000 invocations.

**Hidden processing inside `fetch_url`** (presets page, for the `medium` and `high` presets, verbatim): "**`fetch_url` processing:** grep is disabled, and content extraction uses medium effort. These are preset-level settings and are not request-settable fields." This implies `fetch_url` normally runs an in-page **grep** and an **LLM extraction step with an effort level** before the model sees anything. So the model sees query-focused extracts ("snippets"), not the raw page. The details are not documented.

## 1.3 Prompt rules (the preset system prompts, verbatim)

Presets bundle a model, tools, step limit and a system prompt. The docs publish the current values:

| Preset | Model | Max steps | Tools | Search config |
|---|---|---|---|---|
| `fast` | `openai/gpt-5.6-luna`, reasoning `minimal` | 1 | `web_search` | `max_results: 10` |
| `low` | `openai/gpt-5.6-luna`, `minimal` | 5 | `web_search`, `fetch_url` (`max_urls: 1`) | `max_results: 15`, `max_tokens: 2000`, `max_tokens_per_page: 2000` |
| `medium` | `openai/gpt-5.6-luna`, `medium` | 15 | same | same; fetch_url grep disabled |
| `high` | `openai/gpt-5.6-sol`, `medium` | 15 | same | same; fetch_url grep disabled |
| `xhigh`, `wide-research` | `openai/gpt-5.6-sol`, `high` | 100 | `web_search`, `finance_search`, `sandbox` | `max_results: 15` |

**`low`, `medium`, `high` system prompt** (the research presets), verbatim:

```text
Today is ${current_date}.

You are an expert research assistant. Use the available search and other tools to gather evidence before answering: break the question into parts, make the tool calls needed to cover every part, and read the results carefully.

Search queries must be plain keywords. Never use quotation marks, AND, OR, or NOT inside a query — the search engine does not parse operators and treats them as literal text, which degrades results. To cover alternatives or exact phrases, send several short keyword queries instead.

## Citations
<citation_instructions>
Cite when your answer uses tool results or provided source artifacts. If no tools or source artifacts inform the answer, do not cite.

After any successful tool call, the final answer must include at least one valid citation.

When a tool helps answer the user, include citations for the parts of the answer that come from that lookup. Source-backed facts, current claims, named entities, recommendations, and examples should be cited at the point where they appear. A single citation may support one concise bullet or paragraph when that whole point comes from the same source.

Use source ids exactly as provided by the tool/source system, preserving the source type prefix: [type:index]. For web sources, use [web:n], not numeric-only [n]. Place each citation inline, immediately after the sentence or table-cell content it supports. For multiple sources, write adjacent citation tokens with no separator: [web:1][file:2]. Do not invent source ids, cite URLs directly, add footnotes, or include a References section.

</citation_instructions>

ALWAYS end your turn with a complete final answer. This rule overrides everything else:
- Never stop after only tool calls, and never return an empty, partial, or placeholder response.
- Never refuse, never say you "cannot complete" the task, lack access, or need more information.
- If the evidence is incomplete, conflicting, or uncertain, still commit to your single most likely answer based on the best available evidence and reasonable inference. State that answer first; you may add at most one short caveat, but never withhold it.

Format:
- Answer the exact question asked, directly and specifically — give the precise name, number, date, or entity requested, stated up front.
- Ground your answer in the tool evidence and cite sources for factual claims where available.

When the question asks for multiple items (a list, "all"/"every", or anything enumerable), give your answer as a COMPLETE markdown table:
- One header row using exactly the columns the question asks for, then one row per item.
- Be exhaustive: include EVERY qualifying item you can find, not just a few examples.
- Fill every cell precisely (exact name, number, date, or URL); leave a cell empty only if the value is genuinely unavailable.
```

**`fast` preset system prompt**, the tool and citation part, verbatim (the rest of this 6,000-character prompt is answer formatting rules by query type):

```text
## Tools Workflow
<tools_workflow>
You must call the web search tool before answering. Do not rely on internal knowledge when search results can provide current, verifiable information.

- Decompose complex queries into discrete, parallel search calls for accuracy
- Use short, keyword-based queries (2-5 words optimal, 8 words maximum)
- Do not generate redundant or overlapping queries
- Match the language of the user's query
- If search results are empty or unhelpful, answer using existing knowledge and state this limitation

<tool_call_limit>Make at most one tool call before concluding.</tool_call_limit>
</tools_workflow>

## Citation Instructions
<citations>
Your response must include citations. Add a citation to every sentence that includes information derived from search results.

<formatting>
- Use brackets with the source index immediately after the relevant statement: [1], [2], etc.
- Do not leave a space between the last word and the citation
- When multiple sources support a claim, use separate brackets: [1][2][3]
- Cite up to three relevant sources per sentence, choosing the most pertinent results
- Never use formats with spaces, commas, or dashes inside brackets
- Citations must appear inline, never in a separate References section
</formatting>
```

**Default instructions when no preset is given** (these came back in the `instructions` field of a docs example response that used `tools: [web_search, fetch_url]` without a preset), the tool and citation part, verbatim:

```text
<tools_workflow>
Begin each turn with tool calls to gather information. You must call at least one tool before answering, even if information exists in your knowledge base. Decompose complex user queries into discrete tool calls for accuracy and parallelization. After each tool call, assess if your output fully addresses the query and its subcomponents. Continue until the user query is resolved or until the <tool_call_limit> below is reached. End your turn with a comprehensive response. Never mention tool calls in your final response as it would badly impact user experience.

<tool_call_limit> Make at most three tool calls before concluding.</tool_call_limit>
</tools_workflow>

## Citation Instructions
<citation_instructions>
Your response must include at least 1 citation. Add a citation to every sentence that includes information derived from tool outputs.
Tool results are provided using `id` in the format `type:index`. `type` is the data source or context. `index` is the unique identifier per citation.
<common_source_types> are included below.

<common_source_types>
- `web`: Internet sources
- `page`: Full web page content
- `conversation_history`: past queries and answers from your interaction with the user
</common_source_types>

<formatting_citations>
Use brackets to indicate citations like this: [type:index]. Commas, dashes, or alternate formats are not valid citation formats. If citing multiple sources, write each citation in a separate bracket like [web:1][web:2][web:3].

Correct: "The Eiffel Tower is in Paris [web:3]."
Incorrect: "The Eiffel Tower is in Paris [web-3]."
</formatting_citations>
```

Note the source type `page` ("Full web page content"): fetched pages get their own citation namespace, separate from search results (`web`).

**`xhigh` / `wide-research` prompt**, verbatim excerpt: these presets drop `fetch_url` entirely and instead tell the model to load a skill and write Python against Perplexity's `pplx_sdk` ("multi-index search, content fetch / snippets, LLM extraction, parallel fan-out, multi-step pipelines, checkpoint-resumable workflows"), running in the `sandbox` tool: "For research not covered by a specialized tool, before doing anything else for the user's task, call `load_skill({"name":"pplx_sdk"})` and read the returned SKILL.md ... Reading it is mandatory, not advisory." Perplexity calls this approach "Search as Code".

---

# Part 2. xAI (Grok) server-side tools

You enable tools with `tools: [{type:"web_search"}, {type:"x_search"}]` (Responses API) or `xai_sdk.tools.web_search()` / `x_search()`. xAI runs the agent loop and only returns the final answer, the tool-call trace, and citations. From the docs, verbatim: "Only the tool call invocations are shown — **server-side tool call outputs are not returned** in the API response."

**One configured tool expands into several model-facing functions.** The docs' usage table (`tool-usage-details.md`) lists, verbatim:

| Usage Category | Function Name(s) |
|---|---|
| `SERVER_SIDE_TOOL_WEB_SEARCH` | `web_search`, `web_search_with_snippets`, `browse_page`, `open_page`, `open_page_with_find` |
| `SERVER_SIDE_TOOL_X_SEARCH` | `x_user_search`, `x_keyword_search`, `x_semantic_search`, `x_thread_fetch` |
| `SERVER_SIDE_TOOL_VIEW_IMAGE` | `view_image` |
| `SERVER_SIDE_TOOL_VIEW_X_VIDEO` | `view_x_video` |

In my probe `grok-4.20-0309-non-reasoning` saw exactly `web_search` and `browse_page` for the web tool (plus the four X tools). `web_search_with_snippets`, `open_page` and `open_page_with_find` did not appear, so their definitions are unknown; the names suggest a snippet-returning search and a page opener with in-page find, which other Grok models may get. The Responses API reports a `browse_page` call as a `web_search_call` item with `action: {"type": "open_page", "url": "https://serper.dev"}` (probe), reusing OpenAI's action names.

**Developer configuration** (`xai_sdk/tools.py:10-82`, docstring verbatim excerpts):

| Parameter | Description |
|---|---|
| `excluded_domains` | List of website domains (without protocol specification or subdomains) to exclude from search results (e.g., ["example.com"]). ... A maximum of 5 websites can be excluded. This parameter cannot be set together with `allowed_domains`. |
| `allowed_domains` | ... A maximum of 5 websites can be allowed. Use this as a whitelist to limit results to only these specific sites; no other websites will be considered. |
| `enable_image_understanding` | Enables understanding/interpreting images encountered during the web search process. (Docs: this adds the `view_image` tool.) |
| `enable_image_search` | Enables searching for image results that can be embedded in responses. |
| `user_location_*` | country (ISO 3166-1 alpha-2), city, region, timezone. |

Loop bound: `max_turns` (`chat.py:170`, verbatim): "The maximum number of agentic turns the model can take. When set, the model will automatically iterate up to this many turns, calling tools and processing their results until it reaches a final answer or hits the turn limit. Defaults to server-side maximum. ... With parallel tool calls enabled, multiple tool calls can occur within a single turn, so max_turns does not necessarily equal the total number of tool calls." Docs: "When the agent reaches the limit, it will stop making additional tool calls and generate a final response based on information gathered so far."

## 2.1 `web_search` (function)

**Where it runs:** xAI's server.

**Description, verbatim** (`grok-4.6.md:100-127`, confirmed by probe):

```text
This action allows you to search the web. You can use search operators like site:reddit.com when needed.
```

**Parameters, verbatim:**

```json
{
  "name": "web_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "The search query to look up on the web.",
        "type": "string"
      },
      "num_results": {
        "default": 10,
        "description": "The number of results to return. It is optional, default 10, max is 30.",
        "maximum": 30,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": ["query"],
    "type": "object"
  }
}
```

**What the model gets back** (probe, query "Serper API pricing", `num_results: 3`, echoed by Grok, first result shortened by me where marked `[…]`):

```text
[web:1] Serper.dev Pricing 2026: $1/1K Google SERP | serp.fast - https://serp.fast/tools/serper-dev
Published: 2026-09-18 13:57 UTC
Content: L1: Published: 2026-09-18
# Serper.dev Pricing 2026: $1/1K Google SERP | serp.fast
L6: # Serper.dev
L8: Visit Serper.dev ↗
L10: Fast Google SERP API priced at a dollar per thousand queries
[…]
L26: ## Our verdict
L28: The price-to-performance ratio is unbeatable at $1/1K queries with 1-2 second response times.
L28: Extremely popular with AI startups for good reason.
...
L79: ### How much does Serper.dev cost?
L81: Serper.dev charges $1 per 1,000 standard queries on its starter tier (the $50 pack of 50,000 credits), which makes it the cheapest production Google SERP API on the market.
L81: Larger prepaid packs drop the per-query price further – $375 buys 500,000 credits at $0.75/1K, scaling down to about $0.30/1K on the largest ($3,750) pack, with higher throughput (up to 300 QPS) at each step.

[web:2] Serper Pricing Explained (2026): Credits, Expiry, Real Cost - https://apiserpent.com/blog/serper-pricing-credits-explained
Published: 2026-07-17 00:00 UTC
Content: L14: **Quick answer:** Serper sells prepaid credit packs from $50 (50,000 credits) to $3,750 (12.5 million), working out to roughly $1.00 down to $0.30 per 1,000 queries.
[…]
```

Each result is a header line `[web:N] <title> - <url>`, a `Published:` line when known, and `Content:` made of query-relevant passages from the whole page, each prefixed with its **line number in the page** (`L81:`), with `...` between gaps. Each result in the probe carried roughly 1,500 to 2,500 characters. The line numbers let the model see where in the page a passage sits. The `[web:N]` id is what the model cites.

## 2.2 `browse_page` (function)

**Where it runs:** xAI's server, and the page is read by **another LLM** (the "summarizer"), not by Grok.

**Description, verbatim** (`grok-4.6.md:51-76`, and `xAI-grok4.20_20260217.md:35`, confirmed by probe):

```text
Use this tool to request content from any website URL. It will fetch the page and process it via the LLM summarizer, which extracts/summarizes based on the provided instructions.
```

**Parameters, verbatim:**

```json
{
  "name": "browse_page",
  "parameters": {
    "properties": {
      "url": {
        "description": "The URL of the webpage to browse.",
        "type": "string"
      },
      "instructions": {
        "description": "The instructions are a custom prompt guiding the summarizer on what to look for. Best use: Make instructions explicit, self-contained, and dense—general for broad overviews or specific for targeted details. This helps chain crawls: If the summary lists next URLs, you can browse those next. Always keep requests focused to avoid vague outputs.",
        "type": "string"
      }
    },
    "required": ["url", "instructions"],
    "type": "object"
  }
}
```

**What it returns:** the summarizer's output, headed like a search result. Probe on `https://serper.dev` (a JavaScript-heavy page) with instructions "list the pricing tiers" returned an empty body:

```text
[web:0] Serper - The World's Fastest and Cheapest Google Search API - https://serper.dev/
Content: 
```

So a failed extraction comes back as empty content with no error text. The page gets a citable `[web:N]` id just like a search result.

## 2.3 X search functions

Verbatim from `grok-4.6.md:129-296` (confirmed by the probe except that Grok garbled the `Time/ID` line of `x_keyword_search` when echoing it; the leaked text is used here).

`x_keyword_search`: "Advanced search tool for X Posts." Parameters: `query` (string, required), with description:

```text
The search query string for X advanced search. Supports all advanced operators, including:
Post content: keywords (implicit AND), OR, "exact phrase", "phrase with * wildcard", +exact term, -exclude, url:domain.
From/to/mentions: from:user, to:user, @user, list:id or list:slug.
Location: geocode:lat,long,radius (use rarely as most posts are not geo-tagged).
Time/ID: since:YYYY-MM-DD, until:YYYY-MM-DD, since:YYYY-MM-DD_HH:MM:SS_TZ, until:YYYY-MM-DD_HH:MM:SS_TZ, since_time:unix, until_time:unix, since_id:id, max_id:id, within_time:Xd/Xh/Xm/Xs.
Post type: filter:replies, filter:self_threads, conversation_id:id, filter:quote, quoted_tweet_id:ID, quoted_user_id:ID, in_reply_to_tweet_id:ID, in_reply_to_user_id:ID, retweets_of_tweet_id:ID, retweets_of_user_id:ID.
Engagement: filter:has_engagement, min_retweets:N, min_faves:N, min_replies:N, -min_retweets:N, retweeted_by_user_id:ID, replied_to_by_user_id:ID.
Media/filters: filter:media, filter:twimg, filter:images, filter:videos, filter:spaces, filter:links, filter:mentions, filter:news.
Most filters can be negated with -. Use parentheses for grouping. Spaces mean AND; OR must be uppercase.

Example query:
(puppy OR kitten) (sweet OR cute) filter:images min_faves:10
```

`limit` (integer, default 3, max 10, "The number of posts to return. Default to 3, max is 10."), `mode` (string, default "Top", "Sort by Top or Latest. The default is Top. You must output the mode with a capital first letter.").

`x_semantic_search`: "Fetch X posts that are relevant to a semantic search query." Parameters: `query` ("A semantic search query to find relevant related posts"), `limit` (default 3, max 10), `from_date` / `to_date` ("Optional: Filter to receive posts from this date onwards. Format: YYYY-MM-DD"), `usernames`, `exclude_usernames`, `min_score_threshold` (default 0.18, "Optional: Minimum relevancy score threshold for posts.").

`x_user_search`: "Search for an X user given a search query." Parameters: `query` ("The name or account you are searching for"), `count` (default 3).

`x_thread_fetch`: "Fetch the content of an X post and the context around it, including parent posts and replies." Parameter: `post_id`.

Developer configuration (`tools.py:85-150`): `from_date`, `to_date`, `allowed_x_handles` / `excluded_x_handles` (max 20, mutually exclusive), `enable_image_understanding`, `enable_video_understanding`. Since 2026-09-21 X Search is billed per item: $5 per 1,000 posts and $10 per 1,000 user profiles fetched.

## 2.4 Citations and prompt rules

The tool instructions Grok printed in the probe (verbatim excerpt; they match `grok-4.6.md:758-765`):

```text
Key factual statements that derive from web search results/browse page/X searches need to be cited with the render_inline_citation tool.

### Render Inline Citation
- **Description**: Display an inline citation as part of your final response. This component must be placed inline, directly after the final punctuation mark of the relevant sentence, paragraph, bullet point, or table cell.
Do not cite sources any other way; always use this component to render citation. You should only render citation from web search, browse page, X search, or document search results, not other sources.
This component only takes one argument, which is "citation_id" and the value should be the citation_id extracted from the previous web search, browse page, or X search tool call result which has the format of '[web:citation_id]', '[post:citation_id]', '[collection:citation_id]', or '[connector:citation_id]'.
Finance API, sports API, and other structured data tools do NOT require citations.
- **Type**: `render_inline_citation`
- **Arguments**:
  - `citation_id`: The id of the citation to render. Extract the citation_id from the previous web search, browse page, or X search tool call result which has the format of '[web:citation_id]' or '[post:citation_id]'. (type: integer) (required)
```

So the model cites by emitting a render component with the integer id; the server then turns it into `[[N]](url)` markdown links and `url_citation` annotations with `start_index` / `end_index` (docs `citations.md`). Separately, `response.citations` lists every URL the agent encountered, cited or not ("Note that not every URL in this list will necessarily be directly referenced in the final answer").

---

# Part 3. Exa and Firecrawl agent-facing tools (client side)

## 3.1 Exa `web_search` and `get_contents` (exa-js)

**Where they run:** your process. `exa.tools.webSearch()` / `getContents()` build a tool definition plus a `run()` that calls the Exa API and formats the result as text (`exa-js/src/tools/core.ts`; `openai.ts` and `anthropic.ts` wrap these into each vendor's tool format).

**Descriptions, verbatim** (`core.ts:86-90`):

```text
Search the web for up-to-date, relevant information. Describe the ideal page rather than listing keywords.
```

```text
Read the full contents of web pages you already have URLs for, such as pages returned by a search or mentioned by the user.
```

**Parameters, verbatim** (`core.ts:184-189`, `234-239`):

| Tool | Name | Type | Required | Description |
|---|---|---|---|---|
| `web_search` | `query` | string | yes | Natural language search query. Should be a semantically rich description of the ideal page, not just keywords. |
| `get_contents` | `urls` | string[] | yes | Absolute URLs of the pages to read, including the scheme. Pass several URLs to read them in a single call. |

Developer config: any Exa search or contents option (`numResults`, `type`, date and domain filters, `highlights`, `text.maxCharacters`, and so on), plus a custom `name` / `description`.

**What happens:** `web_search` calls `exa.search(query, {type: "auto", numResults: 10, contents: {highlights: true}, ...config})` (`core.ts:203-211`). `get_contents` calls `exa.getContents(urls, config)`, which returns page text by default. Results are formatted by `formatResults` (`core.ts:92-117`) as blocks separated by `\n\n---\n\n`:

```text
Title: <title or N/A>
URL: <url>
Published: <date or N/A>
Author: <author or N/A>
Summary: <only if a summary was requested>
Highlights:
<highlight 1>
<highlight 2>
```

(`Text: <page text>` replaces `Highlights:` when there are no highlights.) Empty results give `No search results found.` / `No contents found.`; exceptions give `Error: <message>`.

## 3.2 Firecrawl `firecrawl_search` and `firecrawl_scrape` (PHP / Laravel AI SDK)

**Where they run:** your process, calling the Firecrawl API. These Laravel tools are the only model-facing tool definitions in the Firecrawl repo (the JS SDK's `tools.ts` is an API method, not an agent tool).

**Descriptions, verbatim** (`FirecrawlSearch.php:18-23`, `FirecrawlScrape.php:18-23`):

```text
Search the web with Firecrawl and return matching results as a JSON array of {title, url, description} objects. Use this to find relevant pages when you do not already know the URL. Follow up with firecrawl_scrape to read the full content of a result.
```

```text
Scrape a single web page with Firecrawl and return its content as clean markdown. Use this when you already know the URL of the page you need to read. Handles JavaScript-rendered pages, PDFs, and pages behind anti-bot protection.
```

**Parameters:** `firecrawl_search`: `query` (string, required, "The search query."), `limit` (integer 1 to 20, "Maximum number of results to return. Defaults to 5."). `firecrawl_scrape`: `url` (string, required, "The absolute URL of the page to scrape, including the scheme (e.g. https://example.com/pricing).").

**What happens:** search returns a JSON array of `{title, url, description}`; if the JSON exceeds 100,000 characters (`FirecrawlTool.php:20`), the list is halved until it fits and an `{"omitted": N}` entry is appended. Scrape returns markdown cut at 80,000 characters (`FirecrawlScrape.php:36`) with the suffix `\n\n[Truncated: {total} characters total.]` (`FirecrawlTool.php:113`), so the model at least learns how long the page was.

---

## What is distinctive

- **Perplexity**: search results carry both a publication `date` and a `last_updated` date, plus a stable `id` that the model cites as `[web:N]`; fetched pages have their own `page` citation type. Token budgets (`max_tokens`, `max_tokens_per_page`) are the main knob rather than result count. `fetch_url` does not hand the raw page to the model: presets mention an in-page grep and an LLM "content extraction" step with an effort setting. The published preset prompts are blunt about budget ("Make at most one tool call before concluding", "at most three") and about always committing to an answer ("never withhold it"). Their query advice (short keyword queries, split into parallel searches, no quotes or operators) is the opposite of OpenRouter's (one query with every criterion).
- **xAI**: search results are **line-numbered excerpts** (`L81: ...`) chosen from anywhere in the page, which is an unusual and compact way to give query-relevant context with location. Page reading (`browse_page`) is **delegated to an LLM summarizer driven by the model's `instructions`**; the main model never sees the raw page, and a failed extraction returns an empty `Content:`. The docs name `open_page_with_find` and `web_search_with_snippets`, which suggests an in-page find tool exists for some models, but I could not see it. Citations are integer ids rendered through a special `render_inline_citation` component. Budget is `max_turns`, not told to the model.
- **Exa**: the query is meant to be a description of the ideal page ("not just keywords"), and results are highlights by default. `get_contents` takes a list of URLs.
- **Firecrawl**: scrape returns markdown up to 80,000 characters and states the total length when it truncates, which neither OpenRouter nor our bot does.
- **Surprise**: none of these hosted systems exposes an offset or page-through parameter for reading long documents. They all either return query-focused extracts (Exa highlights, Perplexity snippets, Grok's line-numbered passages) or run a second LLM over the page (Grok `browse_page`, Perplexity `fetch_url` extraction).
