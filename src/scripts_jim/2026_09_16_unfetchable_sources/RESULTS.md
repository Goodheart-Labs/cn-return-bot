# Sources the verifier could not fetch (GOO-167)

Investigation, 2026-09-16. Everything here was measured from this VPS, a
netcup datacenter address in Vienna. Production fetched from two other
datacenter addresses during the sample. Until 2026-09-09 14:38 UTC the X bot's
verifier ran on GitHub Actions runners (Microsoft Azure addresses). From then
on both the X bot and Common Notes send their claim checks, verifier included,
to the claim-check service on the Hetzner services machine in Nuremberg. Of the
385 sampled pages, 203 first failed on GitHub and 182 on Hetzner.

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

| cause | urls | share | example |
|---|---:|---:|---|
| fetches fine from this VPS with a plain client | 93 | 24% | https://www.nbcchicago.com/entertainment/billy-ray-cyrus-reveals-heartfelt-messa |
| dead link (404 from every client) | 77 | 20% | https://www.nist.gov/pao/questions-and-answers-about-nist-wtc-towers-investigati |
| bot defence: cloudflare | 54 | 14% | https://www.sciencedirect.com/science/article/pii/S022352342300805X |
| TLS fingerprint block (opens once the handshake looks like Chrome) | 45 | 12% | https://www.espn.com/soccer/story/_/id/39436612/messi-bench-ronaldo-absent-al-na |
| bot defence: datadome | 24 | 6% | https://www.cbo.gov/publication/61469 |
| social platform (login wall or app shell) | 24 | 6% | https://www.tiktok.com/@maymartins22/video/7528225534640229638 |
| 200 but no readable text (JavaScript app, consent gate or paywall shell) | 17 | 4% | https://geohub.brampton.ca/pages/profile-diversity |
| bot defence: akamai | 8 | 2% | https://www.maritime.dot.gov/msci/2026-004-persian-gulf-strait-hormuz-and-gulf-o |
| AWS WAF JavaScript challenge | 8 | 2% | https://www.imdb.com/name/nm13564038/ |
| other (HTTP 406/404) | 6 | 2% | https://www.cbsnews.com/news/kennedy-center-ceiling-collapse-renovations/ |
| PDF (this diagnosis does not parse PDFs; the pipeline does) | 4 | 1% | https://uu.diva-portal.org/smash/get/diva2%3A1927772/FULLTEXT01.pdf |
| bot defence: imperva | 4 | 1% | https://www.cato.org/blog/5000-check-tariffs-cant-cover |
| network error (DNS, timeout, reset) | 4 | 1% | https://www.asianetnewsable.com |
| blocked with HTTP 403/200, vendor not identified | 3 | 1% | https://shop.wwe.com/en/title-belts-side-plates/d-3473903707-4506909353+z-9-1177 |
| bot defence: human/perimeterx | 3 | 1% | https://www.bloomberg.com/news/articles/2026-09-13/xi-pitches-his-ai-vision-at-b |
| blocked with HTTP 403/404, vendor not identified | 3 | 1% | https://www.uefa.com/news/02a9-1b32f94c0a5b-096a6058e77a-1000--2026-ballon-d-or- |
| blocked with HTTP 429/200, vendor not identified | 2 | 1% | https://www.gettyimages.com/photos/trump-epstein |
| blocked with HTTP 403/403, vendor not identified | 2 | 1% | https://www.instituteforgovernment.org.uk/explainer/keir-starmer-need-to-do-firs |
| other (HTTP 500/500) | 1 | 0% | https://www.tennessean.com/story/sports/nfl/titans/2026/09/13/titans-moments-jet |
| blocked with HTTP 404/403, vendor not identified | 1 | 0% | https://www.pewresearch.org/race-and-ethnicity/2023/08/16/facts-on-hispanics-of- |
| other (HTTP 451/451) | 1 | 0% | https://www.sfweekly.com/archives/orfn-a-life-under-shadows/article_c3dd0a38-ab5 |
| other (HTTP 999/999) | 1 | 0% | https://www.linkedin.com/in/mark-haefele-7a7b271/ |

Reading the table:

- **Dead links (20%).** Both clients get a 404. The writer cited a page that
  does not exist: a hallucinated or mangled URL, or an article that was moved.
  No fetcher fixes this. The archives can, when the page once existed.
- **Fetches fine from this VPS with a plain client (24%).** These failed in
  production but a plain Python client fetched them here. Part of this may be
  the origin address or the passing of time: our own ladder, run from the VPS,
  recovered 33% of the pages that failed on GitHub and 32% of those that failed
  on Hetzner, so neither production address stands out, and a retry days
  later also meets fewer rate limits and outages. Part of it is our client,
  see section 4, because that same ladder recovered only 57 of these 93.
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
   archive. Production still logs 113 archive fetches in 14 days, so the
   Internet Archive treats production's addresses better than this VPS, but each
   failing URL still spends up to 25 seconds on those two steps before the
   browser runs. The official CDX API with a one-request-per-second throttle and
   backoff did no better in the next section: 503 or connection refused on 360
   of 385 lookups.
3. **Readability drops pages it cannot parse.** `theifab.com` and `nps.gov`
   come back 200 with 45,000 and 13,000 characters of text, and Readability
   keeps 111 and 84 of them. The ladder then classifies the page as "thin" and
   walks on. `htmlToMarkdown` only falls back to stripping tags when Readability
   returns nothing, not when it returns almost nothing. About 20 of the 84 "thin
   content" failures in the sample look like this (a plain fetch here gives
   more than 300 characters of readable text).

## 5. What each candidate tool recovers

All 385 URLs unless stated. Rows are ordered as the ladder would try them; the
`ladder_from_vps` row is our current code run from this VPS, the baseline.

| tool | tested | recovered | rate |
|---|---:|---:|---:|
| ladder_from_vps | 385 | 125 | 32% |
| curl_cffi | 385 | 138 | 36% |
| jina | 385 | 230 | 60% |
| exa | 385 | 95 | 25% |
| exa_fallback | 385 | 207 | 54% |
| wayback | 385 | 15 | 4% |
| commoncrawl | 385 | 12 | 3% |
| patchright | 385 | 109 | 28% |
| openrouter | 60 | 17 | 28% |

Per cause (recovered / tested):

| cause | ladder_from_vps | curl_cffi | jina | exa | exa_fallback | wayback | commoncrawl | patchright | openrouter |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fetches fine from this VPS with a plain client | 57/93 | 93/93 | 90/93 | 54/93 | 86/93 | 8/93 | 7/93 | 60/93 | 4/18 |
| dead link (404 from every client) | 0/77 | 0/77 | 0/77 | 0/77 | 0/77 | 0/77 | 0/77 | 0/77 | 0/6 |
| bot defence: cloudflare | 11/54 | 0/54 | 24/54 | 7/54 | 34/54 | 1/54 | 0/54 | 1/54 | 5/10 |
| TLS fingerprint block (opens once the handshake looks like Chrome) | 41/45 | 45/45 | 40/45 | 9/45 | 37/45 | 4/45 | 1/45 | 31/45 | 3/9 |
| bot defence: datadome | 5/24 | 0/24 | 11/24 | 5/24 | 12/24 | 0/24 | 2/24 | 0/24 | 1/4 |
| social platform (login wall or app shell) | 7/24 | 0/24 | 15/24 | 4/24 | 7/24 | 0/24 | 0/24 | 8/24 | 1/3 |
| 200 but no readable text (JavaScript app, consent gate or paywall shell) | 2/17 | 0/17 | 16/17 | 6/17 | 9/17 | 0/17 | 0/17 | 5/17 | 1/3 |
| bot defence: akamai | 0/8 | 0/8 | 2/8 | 1/8 | 4/8 | 0/8 | 2/8 | 1/8 | 0/1 |
| AWS WAF JavaScript challenge | 0/8 | 0/8 | 7/8 | 0/8 | 4/8 | 0/8 | 0/8 | 1/8 | - |
| other (HTTP 406/404) | 0/6 | 0/6 | 6/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/1 |
| PDF (this diagnosis does not parse PDFs; the pipeline does) | 1/4 | 0/4 | 4/4 | 3/4 | 3/4 | 0/4 | 0/4 | 0/4 | 1/2 |
| bot defence: imperva | 0/4 | 0/4 | 3/4 | 1/4 | 2/4 | 1/4 | 0/4 | 1/4 | - |
| network error (DNS, timeout, reset) | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/1 |
| blocked with HTTP 403/200, vendor not identified | 0/3 | 0/3 | 3/3 | 0/3 | 0/3 | 1/3 | 0/3 | 0/3 | - |
| bot defence: human/perimeterx | 0/3 | 0/3 | 3/3 | 2/3 | 3/3 | 0/3 | 0/3 | 0/3 | - |
| blocked with HTTP 403/404, vendor not identified | 0/3 | 0/3 | 1/3 | 0/3 | 1/3 | 0/3 | 0/3 | 0/3 | - |
| blocked with HTTP 429/200, vendor not identified | 0/2 | 0/2 | 2/2 | 2/2 | 2/2 | 0/2 | 0/2 | 1/2 | - |
| blocked with HTTP 403/403, vendor not identified | 1/2 | 0/2 | 0/2 | 0/2 | 1/2 | 0/2 | 0/2 | 0/2 | 1/1 |
| other (HTTP 500/500) | 0/1 | 0/1 | 1/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | - |
| blocked with HTTP 404/403, vendor not identified | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | - |
| other (HTTP 451/451) | 0/1 | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 | 0/1 | 0/1 | - |
| other (HTTP 999/999) | 0/1 | 0/1 | 1/1 | 0/1 | 1/1 | 0/1 | 0/1 | 0/1 | 0/1 |

What one addition on top of our own ladder buys, counting only pages the ladder
did not already get from this VPS:

```
our ladder from this VPS: 125
  + curl_cffi: +40 -> 165
  + jina: +116 -> 241
  + exa: +43 -> 168
  + exa_fallback: +104 -> 229
  + wayback: +9 -> 134
  + commoncrawl: +9 -> 134
  + patchright: +27 -> 152
  + openrouter: +12 -> 137
```

Hosts no tool recovered (71 pages; mostly dead links and DataDome):

```
3 theguardian.com
    3 tmz.com
    3 researchgate.net
    2 thespun.com
    2 aol.com
    2 forbes.com
    2 kotaku.com
    2 businesswire.com
    1 nist.gov
    1 politifact.com
    1 atlas.co
    1 yemenmonitor.com
    1 foxnews.com
    1 mgoblue.com
    1 cp24.com
    1 health.ec.europa.eu
    1 acg.org
    1 factcheck.org
    1 wikiservice.at
    1 snopes.com
    1 twistedvoxel.com
    1 amp.nfl.com
    1 justice.gov
    1 reddit.com
    1 nps.gov
  total 108
```

How to read the tool rows. "Recovered" means at least 300 characters of
readable text, no login or challenge wall, a 2xx answer, and, for the fetch
services, not a page both direct clients saw as a 404 (Jina and Exa happily
return a site's own "page not found" page with enough footer text to pass the
length bar; 31 of Jina's 261 raw recoveries were that). The `openrouter` row is
a 60-URL sample and undercounts: the prompt asked for verbatim text and the
model refused on some copyrighted pages it had fetched fine.

## 6. Candidate tools, what they are, what they cost

Terms first. A **TLS fingerprint** (industry term, "JA3" or "JA4" after the
hashing schemes) is the pattern of a client's TLS handshake: which cipher
suites, extensions and curves it offers and in which order. Every HTTP library
has its own pattern, and a bot-defence product reads it before the first byte of
HTTP is sent. A **residential proxy** routes the request through a home
internet connection so the site sees a consumer address, not a datacenter one.
A **managed unblocker** (vendor term, Bright Data calls it "Web Unlocker", Zyte
"Zyte API") is a hosted service that takes a URL and returns the page, running
its own proxies, browsers and challenge solvers behind the scenes.

### 6.1 Fix the client: curl-impersonate

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

### 6.2 Fetch services with an API

| service | what it does | free tier | price after | measured here |
|---|---|---|---|---|
| Jina Reader (`r.jina.ai/<url>`) | fetches and renders the page, returns markdown; headers pick the engine (`X-Engine: direct` or browser), a proxy country, cookies | 10M tokens once; 20 requests/min without a key, 500/min with the free key | about $0.02 per 1M output tokens (third-party pages; jina.ai/pricing was a 404) | yes, all URLs |
| Exa `/contents` | returns page text for a URL; `livecrawl: always` fetches live, `fallback` serves Exa's cached copy first | our existing key | $1 per 1,000 pages | yes, both modes, all URLs |
| Claude's server-side `web_fetch` through OpenRouter | the model fetches the page inside the API call; billed as input tokens | none | about $0.018 per page on Sonnet 5 with a 4,000-token cap (measured: $1.10 for 60) | yes, 60-URL sample |
| Firecrawl `/scrape` | hosted fetch with stealth proxies and browser rendering, returns markdown | 1,000 credits per month, 10 requests/min, 1 credit per page | Hobby $16/month for 5,000 pages | no key yet |
| Tavily `/extract` | same idea, aimed at agents | 1,000 credits per month; 5 URLs per credit (basic) | $0.008 per credit | no key yet |
| Managed unblockers (Zyte API, Bright Data Web Unlocker, Scrapfly, ZenRows, ScrapingBee) | built to pass DataDome, Akamai and Cloudflare; billed per successful page | Bright Data: 5,000 requests/month free; others trials | Zyte from $0.13 per 1,000 plain requests up to about $16 per 1,000 browser-rendered ones; Scrapfly anti-bot $0.50 per 1,000; Bright Data about $1 per 1,000 | no |

### 6.3 Open source fetch libraries

| library | what it is | verdict for us |
|---|---|---|
| `curl_cffi` (Python) / `curl-impersonate` binary | browser-identical TLS | the one cheap fix; see 6.1 |
| Patchright (Python and Node) | Playwright fork with the automation leaks patched at the Chrome DevTools Protocol layer; drop-in for our existing Playwright step | measured here (table above) |
| Camoufox | a rebuilt Firefox with fingerprints fixed in the engine; strongest on hard targets, slowest, 200 MB download | not measured; the next step up if Patchright is not enough |
| nodriver / Zendriver | Python, drives Chrome over CDP with no WebDriver | Python only, so it would be a sidecar |
| crawl4ai | a crawling framework on top of Playwright, returns markdown | measured in May 2026 (`2026_05_27_webfetch_and_queue`): 13 of 21, below our own ladder's 14 of 21; nothing changed since |
| trafilatura (Python) | text extraction from HTML; used in this investigation's scripts as the readability check | we already have Readability plus Turndown; no reason to switch |

### 6.4 The sites' own official interfaces

| source | official route | finding |
|---|---|---|
| Reddit | Data API: free for non-commercial use at 100 queries/min, but since June 2026 every app needs approval under the Responsible Builder Policy; unauthenticated `.json` answers 403 | `old.reddit.com` with a Chrome handshake returned the full post for 6 of 6 sampled links from this VPS (`06_reddit_probe.py`); the `.json` form is blocked either way |
| YouTube | Data API v3 or yt-dlp | already handled by the media cascade with the residential proxy; the YouTube URLs in this sample reached `fetchWebPage` only because that cascade had failed first |
| Wayback Machine | Availability API (what the ladder uses) and the CDX API; no key, community limit about 1 request/s, 429 above that since the late-2024 hardening | the availability endpoint answered 429 to this VPS on the first call of the day; the CDX route at 1 request/s with backoff answered 503 or refused 360 of 385 lookups and recovered 15 |
| archive.ph | no API; blocks datacenter addresses (uptime checkers from cloud IPs see it as down) | timed out from this VPS; step 5 of the ladder is dead from CI as well |
| Common Crawl | index API plus ranged reads of the WARC file, free | 12 of 385 have a capture in the two newest crawls; the index itself refused connections for 144 lookups |
| Cloudflare Web Bot Auth / pay-per-crawl | crawlers sign requests with a published key; sites can allow or charge them; since 2026-09-15 Cloudflare blocks "mixed-use" crawlers on ad-carrying pages by default | a possible long-term route for a fact-checking bot with a public identity; not something to build this quarter |


## 7. What I would do, in order

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
   Jina Reader is the best measured (+116 pages on top of our ladder: 60% of
   the whole sample, 24 of the 54 Cloudflare pages and 11 of the 24 DataDome pages, because it
   fetches from its own addresses with a real browser), costs nothing at our
   volume (about 300 failed pages a fortnight against 10M free tokens, then
   $0.02 per million), and needs only the key already in `.env` as
   `JINA_READER_API`. Exa's cached mode is second (+104) and we already pay for
   it. Firecrawl and Tavily were not measured for lack of keys; both have free
   tiers of 1,000 pages a month that would cover us.
4. **Drop archive.ph, and give Wayback one short attempt.** archive.ph is
   unreachable from any datacenter address and only costs time. Wayback is not
   much better from here: even the official CDX endpoint at one request a second
   with backoff answered 503 or refused the connection on 360 of 385 lookups
   (15 pages recovered, all 14-day-old news that has a capture). Production
   still gets 113 archive hits a fortnight from its addresses, so keep the
   availability lookup, but with a 5 second timeout instead of 10 plus 15.
5. **Do not pay for a managed unblocker yet.** The DataDome and Cloudflare
   group is 24% of failures, and Jina already takes half of it. A managed
   unblocker (Zyte, Bright Data, Scrapfly) is the next step up if that half is
   worth $1 per 1,000 pages to us, which at our volume is cents; the cost is a
   third vendor and a key, not money.

Not recommended: Patchright as a replacement for the Playwright step (28%,
below the plain Chrome handshake, because headless Chromium on a datacenter
address is still visibly a bot); Common Crawl (3% coverage of the pages we
cite, its crawls are weeks old and news pages rarely make it in); the model's
own `web_fetch` (28% and $0.018 a page, worse and dearer than Jina).

## 8. Caveats

- Nothing here was run from production's own addresses. The "fine from this
  VPS" group mixes "production's address is blocked", "the site was down or
  rate-limiting that day" and "Bun's handshake is blocked", and only the last
  is measured. Running `04_rerun_ladder.ts` on the services machine at the same
  moment as on the VPS would separate the first two.
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
