# How good is our search and fetch harness, and what could replace parts of it

Research for GOO-166, written 2026-09-16. Desk research only, as Jim asked. The production numbers come from the last 14 days of prod logs and are reproduced in full in `prod_stats.md` in this folder (window 2026-09-02 to 2026-09-16). Every claim about a vendor carries a source link. Where a number was measured by the vendor itself, it says so.

## Summary

The harness is three separate things: a **search tool** (one call to Serper, a paid service that returns Google's result page as JSON), a **fetch tool** (a home-made ladder that tries several ways to download a page and turns the HTML into markdown), and a **tool loop** (150 lines that let a model call those two tools a few times and then force a JSON answer). The research and the prod logs give a different verdict for each.

- **The loop is fine as a loop, but it has two holes.** Nothing caps how many tool calls the model may request in one turn, and nothing remembers which pages a run has already fetched. On 2026-09-03 a GLM 5.2 run asked for 2,621 tool calls in a single turn, 2,605 of them fetches of only 16 distinct URLs. The loop ran every one of them, one after another, and the next model call then failed because the results added up to 3.3 million tokens. Frameworks would not have saved us here; no framework's loop is measurably better than another's. Two small edits fix this.
- **Fetch fails between 9% and 21% of the time depending on who calls it**, and the failures are concentrated: 403 answers from a short list of hosts (Reuters, NYT, Reddit, ESPN, CNBC, and, more worryingly, cbo.gov, fda.gov, bls.gov, loc.gov, dhs.gov). These are blocks on datacenter IP addresses, not extraction problems. The Wayback rung still recovers about 4% of the verifier's pages, the headless browser 7% to 11%, and archive.ph recovered **zero** pages in 14 days. Every independent benchmark says the extraction step (HTML to text) is solved and ours is within a few points of the best; the gap is entirely in getting past bot walls. The fix is a residential-IP rung, and we already pay for a residential proxy.
- **The classifier lets homepage shells through.** The runaway run's 2,578 "successful" fetches were all the CTV News homepage navigation menu, 4,890 characters of link lists, which our content check accepted because it is longer than 300 characters and matches no login-wall phrase. A page that redirects to the site's front page is currently a success.
- **Search works, but the model is driving it blind.** Serper answered every call in 14 days. But the model gets ten titles and two-line snippets and is never told it may use quotation marks, `site:`, or a date range, and we never send Google's date filter or use its news results. Cheap models therefore do two things the logs show: they fetch pages whole to see what the snippet hid (2 to 4 fetches per claim, each about 2,000 to 2,900 tokens), and 35 times they fetched a `google.com/search?q=` URL directly, using the fetch tool as a second search engine.
- **"Search inside a fetched page", the pattern Jim asked about, is indeed the standard.** OpenAI's browsing tool, the HuggingFace deep-research browser, Anthropic's newest web fetch tool, the reference MCP fetch server and the coding agents (Claude Code, Codex) all give the model a window into a page plus a find command instead of the whole page. Our tool returns up to 20,000 characters and 10% to 30% of fetched pages hit that cap, so the model never sees the end of long pages. Section 5 has the details and the recommended tool shape.

The ranked list of what to do is in section 7. In short: first fix our own loop and classifier (a day of work, no vendor), then give the model a find-in-page tool and search operators (two or three days, no vendor), then add a residential-IP rung to the fetch ladder using the proxy we already have, and only after that decide whether a content-returning search API is worth an A/B arm.

## 1. What the harness is today

This section is for orientation; the code is in `src/pipeline/tool-calling/`.

**Search.** `fetchSearchResults` in `serper.ts` posts `{ q, num: 10 }` to Serper and keeps title, link, snippet and a human-readable date per organic result. It throws away everything else Serper returns (the answer box, the knowledge panel, "People also ask", top stories). It sends no country, language, date filter or page number. Serper bills one credit per call, $1.00 per 1,000 at our tier (https://apiserpent.com/blog/serper-pricing-credits-explained). The `google_search` tool description the model sees says only "Search Google for web pages matching a query. Returns titles, URLs, and snippets."

**Fetch.** `fetchWebPage` in `tools.ts` walks a ladder: plain HTTP with a desktop browser identity, then a phone browser identity, then Googlebot's identity, then a Wayback Machine snapshot, then an archive.ph snapshot, then a real headless Chromium through Playwright. Each answer goes through `classifyContent`: the HTML is turned into markdown with Mozilla's Readability library (the algorithm behind Firefox's reader view) and Turndown, and the result counts as good when it is at least 300 characters and contains fewer than two login-wall phrases. The first good result is returned, cut at 20,000 characters. There is no offset, no search, no summary.

**Loop.** `runToolLoop` in `toolLoop.ts` calls the model with the two tools, executes whatever tool calls come back one after another, appends the results, and repeats up to `maxTurns` (6 in the X search step, 8 in the Common Notes rater). Turn one forces a tool call. When turns run out, one last call without tools forces the JSON answer.

**Who depends on it.** The Common Notes pipeline (Muse Spark rating and checking claims), the note-needed prefilter and the source verifier's page reads run entirely on this harness. The X bot's search step mostly runs on the providers' own built-in search (Claude, Gemini, Grok, OpenAI arms); about 40% of its A/B weight goes through our Serper loop.

## 2. What production says (14 days, 2026-09-02 to 2026-09-16)

The full tables are in `prod_stats.md`. Numbers below leave out the runaway run described in section 2.3, which is otherwise three quarters of every X search-loop fetch.

### 2.1 Fetch

| Caller | Web fetches | Failed | Succeeded only via Wayback | Succeeded only via archive.ph | Succeeded only via headless browser |
| --- | --- | --- | --- | --- | --- |
| X pipeline, search loop | 798 | 170 (21.3%) | 2 (0.3%) | 0 | 90 (11.3%) |
| X pipeline, source verifier | 2,698 | 303 (11.2%) | 114 (4.2%) | 0 | 183 (6.8%) |
| Common Notes claim check, search loop | 1,181 | 167 (14.1%) | 0 | 0 | 99 (8.4%) |
| Common Notes claim check, source verifier | 919 | 86 (9.4%) | 41 (4.5%) | 0 | 68 (7.4%) |

Failure tags are dominated by HTTP 403 (43% to 61% of failures in every caller), then "thin content" (16% to 29%), then 404 and 401. An HTTP tag here means no rung at all got a page body, not even the archives or the browser. The hosts that fail most: reuters.com (401 on every attempt), reddit.com, nytimes.com, espn.com, cnbc.com, people.com, and the US government sites cbo.gov, fda.gov, bls.gov, loc.gov and dhs.gov, all 403. Academic publishers (pnas.org, sciencedirect.com, researchgate.net) also 403. These are datacenter-IP blocks: the same pages open from a home connection.

Fetched pages are not small. Successful results have a median of about 5,000 characters in the X pipeline and about 10,000 in the Common Notes claim checks, and 10% (X search loop), 14% (X verifier), 29% and 30% (Common Notes verifier and search loop) hit the 20,000-character cap, meaning the model sees a truncated page. The mean is 1,800 to 2,900 tokens per fetch. With 2 to 4 fetches per claim, the fetched pages are the biggest token item in a cheap-model claim check.

Two smaller things the logs show:

- 35 fetches were of `google.com/search?q=...` URLs. The model, given only snippets, tried to read Google's own result page, and the browser rung obligingly rendered it.
- The Common Notes rater (`rateClaims.ts`) calls the loop without a log callback, so its 12 searches and 6 fetches per part never reach the database. Nothing in this report covers it.

### 2.2 Search

| Caller | Searches | Runs with a loop | Searches per run (median) | Median duration | "No results." |
| --- | --- | --- | --- | --- | --- |
| X pipeline, search loop | 2,916 | 887 | 2 | 1.0 s | 2.6% |
| Common Notes claim check, search loop | 3,544 | 707 | 4 | 1.0 s | 5.0% |

Serper never returned `serper_unavailable` in the window. Queries are 8 to 9 words at the median; 23% to 30% contain a quoted phrase, about 1% contain `site:`, none uses the minus operator, and the X queries carry a year 36% of the time (the model writes "September 2026" into the query because it has no other way to ask for recent results).

Muse Spark's provider rejects `tool_choice: required` on every call, so every Muse run goes through the fallback that asks again without forcing a tool. Muse also hits the 6-turn cap and is forced to answer in 11.5% (Common Notes) and 14.1% (X) of runs; Kimi K3 in 1.2%.

### 2.3 The runaway run

Run `13e2aa42-2ec3-4c6e-9468-0a841a7290f0` (X pipeline, arm glm52-serper, 2026-09-03 20:21 UTC) asked for 16 searches and 2,605 fetches in its first turn; the fetches covered 16 distinct URLs, most of them repeated hundreds of times. The loop executed all of them serially. 2,578 "succeeded": the requested CTV News article URL redirects to the CTV News homepage, whose navigation menu comes out of Readability as 4,890 characters of link lists, which passed the classifier. The follow-up model call failed with "requested about 3,329,540 tokens", the run cost $0.036, and the log row is about 12 MB, which is why offset pagination over `pipeline_runs` times out.

Three separate defects meet here: no cap on tool calls per turn, no per-run memory of fetched URLs, and a classifier that cannot tell an article from a homepage.

## 3. Fetch and extraction: what exists

The market has four families. Prices are per the vendor pages linked; "independent" means a benchmark not run by the vendor.

**URL-to-markdown APIs.** One HTTP call does what our whole ladder does.

| Service | What it adds over our ladder | Price | Notes |
| --- | --- | --- | --- |
| Firecrawl `/scrape` (https://www.firecrawl.dev/pricing) | Stealth residential proxies with automatic retry (`proxy: "auto"`), JavaScript actions, PDF parsing, markdown output | Hobby $16/month for 5,000 pages; 1,000 free | Independent anti-bot success 64% to 66% (https://webscraping.cc/, https://scrapeway.com/web-scraping-api/firecrawl); 181k GitHub stars; the self-hosted version has no proxy layer, so it would not help from GitHub Actions |
| Jina Reader `r.jina.ai` (https://jina.ai/reader/) | Prefix any URL; can route through our own proxy via `X-Proxy-Url`; `X-Token-Budget` caps the size | Per token, well under a cent per page; 10M free tokens | States it does not circumvent bot walls; users report Cloudflare 403s |
| Tavily Extract (https://www.tavily.com/pricing) | Batch of 20 URLs, `extract_depth: advanced` for JavaScript pages | $0.0016 per page; 1,000 credits/month free | No anti-bot or PDF statement |
| Exa `/contents` (https://exa.ai/pricing) | Any URL, `highlights` (query-directed excerpts), `summary`, live crawl flag | $1 per 1,000 pages per content type; $10 free monthly | Empty text means blocked; nothing published on bot walls |
| Parallel Extract (https://docs.parallel.ai/extract/extract-quickstart) | Excerpts against an objective, or full markdown; returns `publish_date` | $1 per 1,000 URLs; 5,000 free per month | Also powers OpenRouter's web_fetch; nothing published on bot walls |

**Unblocker APIs.** They sell residential IP addresses plus anti-bot evasion and return the HTML; this is the only family built for our 403 problem.

| Service | Price | Independent success rate | Notes |
| --- | --- | --- | --- |
| Scrapfly (https://scrapfly.io/pricing) | 1 credit plain, 25 residential; failures not billed; 1,000 free | 98% to 99% in three independent tests (https://webscraping.cc/, https://www.zenrows.com/blog/best-web-scraping-apis-benchmarked) | The most consistent performer |
| Bright Data Web Unlocker (https://brightdata.com/pricing/web-unlocker) | $1.50 per 1,000 successful requests; 5,000 free per month | 98% in two tests, 78% in a third | No JavaScript execution |
| Zyte API (https://www.zyte.com/pricing/) | $0.13 to $1.27 per 1,000 by site tier; success only | 90% | Offers a news-article extractor with author and date for a small surcharge |

Vendor benchmarks are unreliable here: ZenRows scores 99% in its own test and 15% in webscraping.cc's. Every public benchmark targets e-commerce and social sites; nobody has published one on news paywalls or government portals, so a number for our hosts would have to be measured by us.

**Model-native fetch tools.** Anthropic's `web_fetch` (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool), OpenRouter's `openrouter:web_fetch` (free engine, or Exa and Parallel at $1 per 1,000; https://openrouter.ai/docs/guides/features/server-tools/web-fetch), Gemini's URL context and Perplexity's `fetch_url` ($0.50 per 1,000) cost only tokens or a fraction of a cent, but they are polite crawlers: they obey robots.txt, do not run JavaScript and fail on bot walls. They fail on exactly the pages we fail on.

**Extraction libraries.** Readability (ours) scores F1 0.947 on the Scrapinghub article benchmark against 0.958 for trafilatura (Python) and 0.970 for the Rust port rs-trafilatura (https://github.com/scrapinghub/article-extraction-benchmark); on WCXB every top system lands between 0.88 and 0.93 on articles (https://webcontentextraction.org/). Defuddle (https://github.com/kepano/defuddle) is a TypeScript alternative with monthly releases, built-in markdown, and a retry with looser rules when the first pass returns nothing; Readability has had no release since March 2025. Swapping extractors would not move the failure rate, because the failures are fetch failures.

**Archives.** News publishers began limiting Internet Archive access in January 2026 and the Guardian excluded its article pages from the Wayback APIs (https://www.niemanlab.org/2026/01/news-publishers-limit-internet-archive-access-due-to-ai-scraping-concerns/). archive.ph requires a CAPTCHA for many IPs, was flagged by Cloudflare after it used its CAPTCHA page to attack a researcher's blog in January 2026, and was banned from Wikipedia in February 2026 (https://en.wikipedia.org/wiki/Archive.today). Our logs show it recovering nothing in 14 days. It should go.

**What we already have and do not use for this.** YouTube fetches from CI go through the DataImpulse residential proxy (`YTDLP_PROXY_URL`, per-GB billing). A residential IP is the one thing the 403 hosts are checking for. A rung "plain HTTP through the residential proxy" between the Googlebot attempt and the archives would test the same hypothesis the unblockers sell, at no new vendor and a few megabytes of proxy traffic per run.

## 4. Search APIs: what exists

**What Serper can do that we do not use.** Serper is a Google proxy, so operators typed into the query already work: quotation marks, `site:`, `before:YYYY-MM-DD`, `after:`, `filetype:pdf`, `-word`. It also accepts Google's `tbs` time filter (`qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`, and custom ranges), `gl` and `hl` for country and language, and `page` (https://docs.litellm.ai/docs/search/serper). It has a `/news` endpoint at the same one credit, plus `/scholar` with a year filter (https://serper.dev/). We discard the answer box and knowledge panel it returns, which often hold the exact number a claim is about. This costs nothing to change.

**Content-returning search.** The best-supported finding across independent benchmarks is that returning relevant passages instead of snippets helps agents. On the Artificial Analysis Search Index (August 2026, one fixed agent, 25 turns max; https://artificialanalysis.ai/articles/search-api) Brave's snippet endpoint scores 65 while Brave's "LLM Context" endpoint, which returns ranked chunks of the pages, scores 75; Perplexity's Search API, which returns extracted page content, tops the table at 80. Better search also cut the agent's token use by over 40% and total cost per task from $0.11 to $0.084 in that study. The Openbenchmarks company-search harness (https://github.com/openbenchmarks-labs/multi-turn-company-search) saw 1 to 9 F1 points from adding fetch to search. Serper itself scored 82% in Tavily's open SimpleQA eval against 93% for Tavily and 86% for Perplexity (https://github.com/tavily-ai/tavily-search-evals), and SerpAPI (also Google) 77% against 91% for Parallel in Parallel's run (https://parallel.ai/articles/best-fast-search-apis). SimpleQA numbers do not transfer between harnesses; the ordering is what to take from them.

| Provider | Returns | Filters | Price per 1,000 | Independent score (AA index) |
| --- | --- | --- | --- | --- |
| Serper (current) | snippets | operators in `q`, `tbs` date, `gl`, `hl`, `/news` | $1.00 (https://apiserpent.com/blog/serper-pricing-credits-explained) | not tested |
| Perplexity Search API (https://docs.perplexity.ai/getting-started/pricing) | extracted page content, sized by `search_context_size` | recency, before/after dates, 20-domain allow or deny list, up to 5 queries per billed call | $5 | 80, best |
| Brave LLM Context (https://brave.com/search/api/) | ranked chunks incl. tables, YouTube captions | `freshness` ranges, `site:`, separate News endpoint | $5; $5 free monthly | 75 |
| Parallel Search (https://parallel.ai/products/search) | excerpts against an `objective` plus keyword `search_queries` | domain policy; no publish-date filter | $1 fast, $5 advanced | 73 to 75, cheapest total spend |
| Exa (https://exa.ai/docs/reference/pricing) | text, highlights, summary; neural and keyword modes | domain lists, published-date range | $7 | 74 |
| Tavily (https://docs.tavily.com/documentation/api-credits) | 1 to 3 chunks per result, optional raw content, `topic=news` | date range, 300 include domains | $8 basic, $16 advanced | 66, most expensive |
| You.com | web and news in one call, highlights or full page | freshness, 500 domains | $5 | 74 |
| Linkup, Kagi, Valyu, TinyFish | various | various | $1.50 to $12 | 67 to 71 where tested |

Not available or not a fit: Google's Programmable Search closes to everyone by January 2027; Bing's API was retired in August 2025 and its successor only exists inside Azure agents; OpenRouter's `:online` plugin runs one search per request from the prompt, so the model cannot iterate. Perplexity's Sonar chat models, which our `bundled` arm uses, are deprecated after 2026-09-27 (https://docs.perplexity.ai/getting-started/models); check the OpenRouter listing before relying on that arm.

**Evidence on query style.** The one fact-checking study with query analysis found that queries padded with speaker or location context often hurt, which argues for short literal queries and exact phrases (https://arxiv.org/html/2409.00009v2). Jina's deep-research write-up calls query rewriting "surprisingly crucial" (https://jina.ai/news/a-practical-guide-to-implementing-deepsearch-deepresearch/). No controlled study isolates `site:` or date operators for LLM agents; the case for exposing them is that fact-checking is date-scoped by nature and primary sources are usually PDFs on official domains, and that cheap models need explicit parameters rather than clever prompting.

## 5. Search inside a fetched page

(Filled in from the dedicated research below.)

## 6. The loop and whole research agents

**Loop frameworks.** Vercel AI SDK (already a dependency, `ai` 6.x, used in three pipeline files; https://ai-sdk.dev/docs/agents/loop-control), OpenRouter Agent SDK (beta, adds a cost-based stop; https://openrouter.ai/docs/agent-sdk/overview), OpenAI Agents SDK for JS, Mastra, LangChain Deep Agents and Google ADK all implement the same loop ours does. None publishes evidence that its loop scores higher than another's. Mastra shipped a bug on 2026-09-12 where every multi-step turn ran to the step ceiling (https://github.com/mastra-ai/mastra/issues/23746), which is the kind of failure a loop we own does not have. The one justification for the AI SDK is consolidation: one loop could drive the Serper arm and the Anthropic, OpenAI and Grok native-search arms that are separate code paths today. That is a refactor, not an accuracy win, and the OpenRouter provider package now targets `ai` 7 while we are on 6.

**What the literature says makes research agents better.** Anthropic's analysis of its research agent found token spend explained 80% of the performance variance, and spend plus number of tool calls plus model choice 95%; parallel tool calls cut research time "up to 90%" (https://www.anthropic.com/engineering/multi-agent-research-system). Widening (several searches per turn) beat deepening on BrowseComp (https://arxiv.org/abs/2602.07359). Agents that are told their remaining budget avoid a performance ceiling (https://arxiv.org/abs/2511.17006). Filtering fetched pages before they enter context cut tokens 37% while raising accuracy in Anthropic's programmatic tool calling study (https://www.anthropic.com/engineering/advanced-tool-use). A synthesis bottleneck exists: models often find the right evidence and still assemble a wrong answer (https://arxiv.org/abs/2510.05137). Our loop lacks exactly two of these: parallel execution of a turn's tool calls, and a budget statement in the prompt. Both are small edits.

**Whole research agents.** The Python applications (gpt-researcher, smolagents Open Deep Research, LangChain's now-archived Open Deep Research) would be a second service in another language producing prose reports, not schema JSON at a few cents per claim. The hosted options are more interesting as A/B arms than as replacements:

- **Perplexity Agent API** (https://docs.perplexity.ai/docs/agent-api/overview): a hosted tool loop over the same cheap third-party models we use (DeepSeek v4, Kimi K3) at provider prices, with a server-side `web_search` at $2.50 per 1,000 calls (content-returning, with date and domain filters) and `fetch_url` at $0.50 per 1,000, and JSON schema output. It would remove Serper and our fetch ladder from a claim check's critical path. It is new and unbenchmarked.
- **Exa Agent** (https://exa.ai/docs/reference/agent-api-guide): fixed effort levels from $0.012 per run, schema-validated JSON with per-field citations. Vendor-run numbers only.
- **Tavily `/research`** and **Firecrawl `/agent`**: wider and less predictable price bands ($0.03 to $2 per request).

**Fact-checking-specific open source.** DEFAME/InFact (https://github.com/multimodal-ai-lab/DEFAME) won the AVeriTeC shared task with explicit sub-question decomposition over Serper and Firecrawl; ClaimCheck (https://arxiv.org/abs/2510.01226) reaches 76% on AVeriTeC with a 4B-parameter model and a well-shaped pipeline, the closest published evidence that a cheap model plus good tools is enough. CommunityFact (https://arxiv.org/abs/2605.30241), a 16,000-claim benchmark built from Community Notes, finds web access gives the largest gains and that web-enabled models pick sources systematically different from the ones human raters trust. None of these is a package to import; they are designs to borrow from.

## 7. Ranked recommendations

Ordered by evidence and by cost to try. Each item names the failure it fixes.

1. **Harden our own loop and classifier (about a day, no vendor).** Cap tool calls per turn (the literature's "3 to 10 tool calls for simple facts" suggests 8), execute a turn's tool calls concurrently, keep a per-run cache of fetched URLs so a repeat costs nothing, and reject homepage shells in `classifyContent` (a redirect whose final path is `/` or whose markdown is mostly links is not an article). Add the log callback to the rater's loop so it becomes measurable. Fixes the runaway run, the 12 MB log rows, and the CTV homepage "success".
2. **Find-in-page tool plus a smaller default page view (two or three days, no vendor).** See section 5 for the shape. Fixes the 10% to 30% of pages the model never sees the end of, cuts the largest token item in a cheap-model claim check, and gives the verifier a way to locate a verbatim quote without reading 20,000 characters.
3. **Make the Serper call a real Google tool (a day, no cost).** Describe the operators in the tool description, add optional date-range, country and page parameters, add a `news_search` tool on `/news`, and pass the answer box and knowledge panel through. Fixes the model writing "September 2026" into queries and fetching `google.com/search` pages.
4. **A residential-proxy rung in the fetch ladder (a day, proxy traffic only).** Plain HTTP through the DataImpulse proxy after the Googlebot attempt. If it recovers the 403 hosts, the unblocker vendors are unnecessary; if it does not, Scrapfly (free tier of 1,000, failures unbilled) is the vendor to try next. Drop the archive.ph rung either way.
5. **A content-returning search arm (after 1 to 4, a few dollars a day).** Perplexity Search API or Brave LLM Context at $5 per 1,000 as an A/B variant in `abTestsData`, measured on verifier acceptance and cost per claim including LLM tokens. The independent evidence favours this over any loop change, but it should be measured against Serper-with-operators, not against Serper as it is today.
6. **Not recommended now:** switching loop frameworks, self-hosting Firecrawl or Crawl4AI (no proxy layer, so same reach as our browser rung), swapping Readability, or replacing the claim check with a hosted research agent. Perplexity Agent and Exa Agent are worth one A/B arm each later, once 1 to 5 give a baseline to beat.
