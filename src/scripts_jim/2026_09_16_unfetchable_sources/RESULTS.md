# Sources the verifier could not fetch (GOO-167)

Investigation, 2026-09-16. Everything here was measured from this VPS, a
Hetzner datacenter address. Production runs on GitHub Actions, which is also a
datacenter address (Microsoft Azure ranges), so the two see the same class of
blocks, but not the same individual block lists.

## 1. Method for finding the sources

The source verifier writes the prompt it sends to the model into the run log
(`pipeline_runs.logs`, under `note_writer_steps.source_verifier`). Each cited
source appears there as a `### <url>` heading followed by the fetched text, or
by `Fetch failed: <reason>` / `Fetch error: <reason>` when the fetch ladder in
`src/pipeline/tool-calling/tools.ts` gave up. `01_extract_failures.py` scans the
last 14 days of both run tables for those headings, one day per query, through
Supabase's management API. The Common Notes claim checks
(`everything_pipeline_runs`, kind `check`) use the same verifier, so they are in
the sample too.

`02_diagnose.py` then fetched every unique failed URL again from this VPS, twice:
once with a plain Python client that sends the pipeline's own browser headers
(its TLS handshake looks like a script, the same as Bun's `fetch`), and once
through `curl_cffi` with `impersonate="chrome"`, where the TLS and HTTP/2
handshake are byte-for-byte those of Chrome. Everything else is equal, so the
difference between the two isolates TLS fingerprinting as the cause.
`04_rerun_ladder.ts` re-ran the pipeline's own six-step ladder from the VPS on
the same URLs.


## 2. How much fails today

X pipeline, 14 days to 2026-09-16, from the run logs (`01b_count_sources.py`,
`data/x_verifier_source_counts_14d.json`):

| what | count |
|---|---:|
| runs in which the verifier ran | 1,820 |
| sources the verifier saw | 3,100 |
| of those, X posts (read through the syndication endpoint) | 251 |
| of those, media links (yt-dlp, gallery-dl and Gemini) | 229 |
| fetched through a Wayback or archive.ph snapshot | 113 |
| fetched through the headless browser | 174 |
| could not be fetched at all | 295 (9.5% of all sources, 11% of web pages) |
| runs that died with "none of the sources could be fetched" | 34 |

So one web source in nine fails, and the archive and browser steps together
already rescue almost as many as still fail. The Common Notes claim checks
added 86 failures in the same window. The two sets overlap in 0 URLs, and after
removing duplicates the sample is **385 unique URLs on 278 hosts**.

A failed source costs a note in most cases: 239 of the 303 X failures sat in a
run whose outcome was `rejected (check_failed)`, and 43 more in runs that were
submitted with that source dropped.

## 3. Why they failed

Every URL was re-fetched from this VPS with a plain client and with a
Chrome-handshake client (`02_diagnose.py`), and the two answers together give
one cause per URL (`05_summarize.py`, table below). The vendor is read from the
answer's headers and body: Akamai leaves an `akamai-grn` header and an
"errors.edgesuite.net" reference, Cloudflare a `cf-ray` header and the "Just a
moment" page, DataDome an `x-datadome` header, Imperva an "Incapsula incident"
line, AWS WAF a 202 answer whose body sets `awsWafCookieDomainList`.

TABLE_CAUSES

Reading the table:

- **Dead links (20%).** Both clients get a 404. The writer cited a page that
  does not exist: a hallucinated or mangled URL, or an article that was moved.
  No fetcher fixes this. The archives can, when the page once existed.
- **Fetches fine from this VPS with a plain client (24%).** These failed in
  production but a plain Python client fetched them here. Part of this is the
  origin address: GitHub Actions runners come from Microsoft Azure ranges that
  many sites block outright, and this VPS is not on those lists. Part of it is
  our client, see section 4, because our own ladder run from this same VPS
  recovered only 57 of these 93.
- **TLS fingerprint block (12%).** The plain client is refused, the same request
  with Chrome's handshake is served. ESPN is the big one (17 pages, it serves an
  empty shell to a script handshake), then LessWrong, Britannica, FBI, DHS. The
  NDTV page from the ticket is in this group.
- **Bot defence with a JavaScript challenge or a datacenter block (24%).**
  Cloudflare (ScienceDirect, ResearchGate, PNAS, NEJM), DataDome (Reuters, NYT,
  Forbes, CBO, TheSpun), Akamai (NDTV's sibling pages, FSIS), AWS WAF (ESPN's
  other pages), Imperva, HUMAN. A Chrome handshake alone does not pass these;
  they check the address reputation and run JavaScript.
- **Social platforms (6%).** Reddit answers 403 to everything but a browser on
  a residential address; Facebook, Instagram and TikTok serve a login shell;
  YouTube serves an app shell. These reach `fetchWebPage` only after the media
  cascade failed, so the fix is in the cascade, not the fetcher. For Reddit,
  `old.reddit.com` with a Chrome handshake served 6 of 6 sampled posts.
- **200 but no readable text (4%).** JavaScript apps, consent gates (Yahoo's
  German privacy page), a PDF the diagnosis did not parse.

## 4. Three problems in our own client

The ladder re-run from this VPS (`04_rerun_ladder.ts`) recovered 125 of the 385,
and 36 of the pages it failed on were fetched by the plain Python client with
the identical headers. `07_bun_client_probe.ts` and a few curl calls pin down
why:

1. **Bun's TLS fingerprint is on deny lists that Python's is not.** AFP
   fact-check pages, sec.gov, bls.gov and defense.gov answer 403 to Bun and to
   curl (OpenSSL 3, with or without HTTP/2, with the full browser header set),
   and 200 to Python's `requests` with the same headers and to curl-impersonate.
   The Washington Post and US News go further: they accept the connection from
   Bun and curl and never answer, so every step of our ladder waits out its 15
   second timeout and the source is logged as "all 6 attempts failed" (29 of
   the 385, 10 of them Washington Post). Python and curl-impersonate get the
   page in under a second. The vendors keep deny lists of the common scraper
   handshakes, and Bun's and curl's are on them.
2. **Wayback and archive.ph are dead from a datacenter address.** The Wayback
   availability lookup answered "429 Too Many Requests" to this VPS on its first
   call of the day, and archive.ph does not answer datacenter addresses at all
   (the connection times out). In the ladder re-run, 0 of 385 pages came from an
   archive. Production still logs 113 archive fetches in 14 days, so GitHub's
   addresses are treated better by the Internet Archive than this VPS, but each
   failing URL still spends up to 25 seconds on those two steps before the
   browser runs. The official CDX API with a one-request-per-second throttle and
   backoff is measured in the next section.
3. **Readability drops pages it cannot parse.** `theifab.com` and `nps.gov`
   come back 200 with 45,000 and 13,000 characters of text, and Readability
   keeps 111 and 84 of them. The ladder then classifies the page as "thin" and
   walks on. `htmlToMarkdown` only falls back to stripping tags when Readability
   returns nothing, not when it returns almost nothing. About 20 of the 84 "thin
   content" failures in the sample look like this (a plain fetch here gives
   more than 300 characters of readable text).

TABLE_TOOLS

TABLE_UNION

How to read the tool rows. "Recovered" means at least 300 characters of
readable text, no login or challenge wall, a 2xx answer, and, for the fetch
services, not a page both direct clients saw as a 404 (Jina and Exa happily
return a site's own "page not found" page with enough footer text to pass the
length bar; 31 of Jina's raw 292 recoveries were that). The `openrouter` row is
a 60-URL sample and undercounts: the prompt asked for verbatim text and the
model refused on some copyrighted pages it had fetched fine.

## 5. Candidate tools, what they are, what they cost

Terms first. A **TLS fingerprint** (industry term, "JA3" or "JA4" after the
hashing schemes) is the pattern of a client's TLS handshake: which cipher
suites, extensions and curves it offers and in which order. Every HTTP library
has its own pattern, and a bot-defence product reads it before the first byte of
HTTP is sent. A **residential proxy** routes the request through a home
internet connection so the site sees a consumer address, not a datacenter one.
A **managed unblocker** (vendor term, Bright Data calls it "Web Unlocker", Zyte
"Zyte API") is a hosted service that takes a URL and returns the page, running
its own proxies, browsers and challenge solvers behind the scenes.

### 5.1 Fix the client: curl-impersonate

- What: a patched curl (MIT, `lexiforest/curl-impersonate`, v2.2.3) whose TLS
  and HTTP/2 handshakes match real Chrome up to version 150, Firefox, Safari and
  Edge. Prebuilt Linux binaries on the release page; `curl_cffi` is its Python
  binding and `impers` its Node binding.
- Bun: `impers` crashes Bun at load (`unsupported uv function: uv_handle_size`,
  Bun 1.3.14), and `node-tls-impersonate` only patches Node's `tls` module, not
  `fetch`, and does nothing for HTTP/2. The way that works in Bun today is to
  run the prebuilt `curl_chrome150` binary as a child process with `execFile`,
  exactly like the pipeline already runs `yt-dlp`. Verified: the binary opens the NDTV page from
  the ticket with a 200 and the full article from this VPS.
- Cost: none. Runtime: same as a plain fetch.
- Limits: it cannot run JavaScript, so it does not pass a challenge page (AWS WAF
  on ESPN, Cloudflare "Just a moment", DataDome's interstitial). It gets past the
  handshake check, which is where most of the 403s come from.

### 5.2 Fetch services with an API

| service | what it does | free tier | price after | measured here |
|---|---|---|---|---|
| Jina Reader (`r.jina.ai/<url>`) | fetches and renders the page, returns markdown; headers pick the engine (`X-Engine: direct` or browser), a proxy country, cookies | 10M tokens once; 20 requests/min without a key, 500/min with the free key | about $0.02 per 1M output tokens (third-party pages; jina.ai/pricing was a 404) | yes, all URLs |
| Exa `/contents` | returns page text for a URL; `livecrawl: always` fetches live, `fallback` serves Exa's cached copy first | our existing key | $1 per 1,000 pages | yes, both modes, all URLs |
| Claude's server-side `web_fetch` through OpenRouter | the model fetches the page inside the API call; billed as input tokens | none | about $0.018 per page on Sonnet 5 with a 4,000-token cap (measured: $1.10 for 60) | yes, 60-URL sample |
| Firecrawl `/scrape` | hosted fetch with stealth proxies and browser rendering, returns markdown | 1,000 credits per month, 10 requests/min, 1 credit per page | Hobby $16/month for 5,000 pages | no key yet |
| Tavily `/extract` | same idea, aimed at agents | 1,000 credits per month; 5 URLs per credit (basic) | $0.008 per credit | no key yet |
| Managed unblockers (Zyte API, Bright Data Web Unlocker, Scrapfly, ZenRows, ScrapingBee) | built to pass DataDome, Akamai and Cloudflare; billed per successful page | Bright Data: 5,000 requests/month free; others trials | Zyte from $0.13 per 1,000 plain requests up to about $16 per 1,000 browser-rendered ones; Scrapfly anti-bot $0.50 per 1,000; Bright Data about $1 per 1,000 | no |

### 5.3 Open source fetch libraries

| library | what it is | verdict for us |
|---|---|---|
| `curl_cffi` (Python) / `curl-impersonate` binary | browser-identical TLS | the one cheap fix; see 5.1 |
| Patchright (Python and Node) | Playwright fork with the automation leaks patched at the Chrome DevTools Protocol layer; drop-in for our existing Playwright step | measured here (table above) |
| Camoufox | a rebuilt Firefox with fingerprints fixed in the engine; strongest on hard targets, slowest, 200 MB download | not measured; the next step up if Patchright is not enough |
| nodriver / Zendriver | Python, drives Chrome over CDP with no WebDriver | Python only, so it would be a sidecar |
| crawl4ai | a crawling framework on top of Playwright, returns markdown | measured in May 2026 (`2026_05_27_webfetch_and_queue`): 13 of 21, below our own ladder's 14 of 21; nothing changed since |
| trafilatura (Python) | text extraction from HTML; used in this investigation's scripts as the readability check | we already have Readability plus Turndown; no reason to switch |

### 5.4 The sites' own official interfaces

| source | official route | finding |
|---|---|---|
| Reddit | Data API: free for non-commercial use at 100 queries/min, but since June 2026 every app needs approval under the Responsible Builder Policy; unauthenticated `.json` answers 403 | `old.reddit.com` with a Chrome handshake returned the full post for 6 of 6 sampled links from this VPS (`06_reddit_probe.py`); the `.json` form is blocked either way |
| YouTube | Data API v3 or yt-dlp | already handled by the media cascade with the residential proxy; the YouTube URLs in this sample reached `fetchWebPage` only because that cascade had failed first |
| Wayback Machine | Availability API (what the ladder uses) and the CDX API; no key, community limit about 1 request/s, 429 above that since the late-2024 hardening | the availability endpoint answered 429 to this VPS on the first call of the day; the CDX route with 1 request/s and backoff is measured above |
| archive.ph | no API; blocks datacenter addresses (uptime checkers from cloud IPs see it as down) | timed out from this VPS; step 5 of the ladder is dead from CI as well |
| Common Crawl | index API plus ranged reads of the WARC file, free | measured above |
| Cloudflare Web Bot Auth / pay-per-crawl | crawlers sign requests with a published key; sites can allow or charge them; since 2026-09-15 Cloudflare blocks "mixed-use" crawlers on ad-carrying pages by default | a possible long-term route for a fact-checking bot with a public identity; not something to build this quarter |


## 6. What I would do, in order

1. **Replace the three plain HTTP steps with one curl-impersonate call.** Run
   the prebuilt `curl_chrome150` binary as a child process (the yt-dlp pattern),
   keep the mobile and Googlebot user agents as its second and third try. This
   is free, needs no account, and fixes the whole "TLS fingerprint" group, the
   "Bun deny-listed" part of the "fine from this VPS" group, the Washington Post
   tarpit, and Reddit through `old.reddit.com`. It also stops wasting 15 seconds
   per step on hosts that tarpit Bun. Measured: +40 pages on top of our ladder
   from this VPS, and every one of the 45 TLS-block pages.
2. **Fix the thin-extraction fallback.** When Readability returns fewer than
   `MIN_GOOD_CONTENT_CHARS` but the stripped page holds far more, use the
   stripped text. One condition in `htmlToMarkdown`.
3. **Add a hosted fetch service as the step before the headless browser.**
   Jina Reader is the best measured (+147 pages on top of our ladder: 68% of
   the whole sample and half of the Cloudflare and DataDome pages, because it
   fetches from its own addresses with a real browser), costs nothing at our
   volume (about 300 failed pages a fortnight against 10M free tokens, then
   $0.02 per million), and needs only the key already in `.env` as
   `JINA_READER_API`. Exa's cached mode is second (+113) and we already pay for
   it. Firecrawl and Tavily were not measured for lack of keys; both have free
   tiers of 1,000 pages a month that would cover us.
4. **Move the archive step to the CDX API with a throttle, or drop archive.ph.**
   archive.ph is unreachable from any datacenter address and only costs time.
   Wayback's availability endpoint rate-limits; the CDX endpoint with one request
   a second is the documented way (numbers in the tool table).
5. **Do not pay for a managed unblocker yet.** The DataDome and Cloudflare
   group is 24% of failures, and Jina already takes half of it. A managed
   unblocker (Zyte, Bright Data, Scrapfly) is the next step up if that half is
   worth $1 per 1,000 pages to us, which at our volume is cents; the cost is a
   third vendor and a key, not money.

Not recommended: Patchright as a replacement for the Playwright step (28%,
below the plain Chrome handshake, because headless Chromium on a datacenter
address is still visibly a bot); Common Crawl (3% coverage of the pages we
cite, its crawls are weeks old and news pages rarely make it in); the model's
own `web_fetch` (30% and $0.018 a page, worse and dearer than Jina).

## 7. Caveats

- Nothing here was run from GitHub Actions. The "fine from this VPS" group
  mixes "GitHub's addresses are blocked" with "Bun's handshake is blocked", and
  only the second is measured. A one-off workflow run of `04_rerun_ladder.ts`
  would split them.
- The prod database went into disk-IO starvation during this investigation
  (health endpoint: db and rest UNHEALTHY from about 20:20 to 20:59 UTC). The
  cause was my day-by-day regex scans of `pipeline_runs.logs` through the
  management API. Do not re-run `01_extract_failures.py` or `01b_count_sources.py`
  against prod as they stand; the logs table needs an index or an archive first.
  A count of the search loop's own `web_fetch` failures was attempted and
  abandoned for the same reason, so section 2 covers the verifier only.
- Firecrawl, Tavily, the residential proxy (DataImpulse, whose credentials
  exist only as GitHub secrets) and Camoufox were not measured.
- The Jina numbers use the default engine. Jina also offers a proxy country
  and a "direct" engine; neither was tried.
- The sample is one fortnight. ESPN and the Lindsay Clancy trial (Reuters,
  Washington Post, NYT) are over-represented because of the news of the week.
