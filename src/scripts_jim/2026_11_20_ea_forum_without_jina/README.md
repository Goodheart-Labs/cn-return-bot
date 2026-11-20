# Reading the EA Forum without Jina (GOO-832)

Jina Reader's balance ran out on 2026-11-19 at 21:42 UTC. Jina was the only
step of our page reader that got past the EA Forum's bot check, so from then on
every read of the forum failed. This folder holds the experiments that found
out what Jina does and how our own machines can do the same. All of them ran
on 2026-11-20.

## The bot check

The EA Forum stands behind Vercel's Security Checkpoint. A request the
checkpoint does not trust gets HTTP 429 with the header
`x-vercel-mitigated: challenge` and a page that runs a script. The script
does some computing in the browser and sends the result to
`/.well-known/vercel/security/request-challenge`. When Vercel accepts it
(status 204), the browser gets the cookie `_vcrcs`, which is its pass for 60
minutes, and the page reloads. When Vercel refuses it, that call answers with
the status 708 and nothing else happens.

## What decides whether a request is checked

Two things, measured with `tls_fingerprint_probe.py` and `browserProbe.ts`.

1. **The address the request comes from.** From the devbox (netcup, Nuremberg)
   a request that looks like a browser is not checked at all. From the
   services box (Hetzner, Helsinki) every request is checked, whatever it
   looks like. I could not tell whether that is Hetzner's network as a whole
   or this one address.
2. **Whether it looks like a browser on the wire.** From the devbox, a plain
   HTTP request passes when it has both a browser's TLS fingerprint (the exact
   shape of the encrypted connection's first message, which differs between
   Chrome, curl and Bun) and a browser's full set of headers. With only one of
   the two it is checked.

| Request, no browser involved | From the devbox | From the services box's address |
|---|---|---|
| curl or Bun's `fetch` with a Chrome user agent | checked | checked |
| The user agent of Googlebot, Bingbot or Feedly | checked | checked |
| Chrome's TLS fingerprint and Chrome's headers (`curl_cffi`) | **passes, HTTP 200** | checked |
| Chrome's TLS fingerprint, but curl's user agent or no extra headers | checked | checked |
| `/feed.xml` and `/robots.txt`, any client | passes | passes |

## What the check's script refuses

From the services box's address a request has to run the script. Our headless
Chromium ran it and was refused. `browserProbe.ts` changed one thing at a
time:

| Chromium | User agent | `navigator.webdriver` | Result |
|---|---|---|---|
| headless shell (what cn-fetch runs) | Mac Chrome 131 (the ladder's) | true | refused, 708 |
| headless shell | its own, which says `HeadlessChrome` | true | refused, 708 |
| headless shell | its own, which says `HeadlessChrome` | false | refused, 708 |
| headless shell | Chrome on Linux | true | refused, 708 |
| headless shell | Chrome on Linux | false | **passes in 2 seconds** |
| headless shell | Mac Chrome 131 (the ladder's) | false | **passes in 2 seconds** |
| new headless mode | its own, which says `HeadlessChrome` | false | refused, 708 |
| new headless mode | Chrome on Linux | false | **passes** |
| with a window (under Xvfb) | its own | true | refused, 708 |
| with a window (under Xvfb) | its own | false | **passes** |

So the script refuses a browser for two reasons: its user agent says
`HeadlessChrome`, or `navigator.webdriver` is true. That property is how
Chromium tells a page that a program drives it, and Chromium started with
`--disable-blink-features=AutomationControlled` leaves it false. Our fetcher
already sent a normal Chrome user agent, so the one thing missing was that
flag. Whether the browser is headless or has a window makes no difference.

The same test on the services box itself, with its own Chromium, gave the same
result: refused with 708 as cn-fetch starts it today, and HTTP 200 after 727
milliseconds with the flag.

## What Jina does

Jina Reader is open source (https://github.com/jina-ai/reader). In
`src/services/puppeteer.ts` it starts Chrome with
`--disable-blink-features=AutomationControlled`, removes the word "Headless"
from the user agent, and injects a script that hides a few more traces
(`minimal-stealth.js`). In `src/services/curl.ts` it also has a libcurl that
sends Chrome's TLS fingerprint and headers. Asked through Jina, a service that
echoes the request back showed exactly that: Chrome's TLS and HTTP/2
fingerprint, Chrome's headers, a user agent without "Headless", coming from
Google Cloud addresses.

So Jina has no trick for the EA Forum in particular. It looks like Chrome on
the wire and comes from addresses Vercel does not check, so it is never asked
to run the script. And if it were asked, its browser hides the same two things
ours now hides.

## What did not work or was not needed

- **Googlebot's user agent**: checked like any other request.
- **The Wayback Machine**: it has no snapshot of new posts, and its newest
  snapshot of the front page was a week old.
- **A browser with a window, or the new headless mode**: neither is needed.
- **The residential proxy**: not tested. Its address is only on the services
  box and in GitHub's secrets, and reading the box's secrets file was outside
  what this task allowed. It would also cost money per gigabyte and can run
  out, which is the failure we are fixing.
- **`/feed.xml`**: the forum leaves its RSS feed open to every client. It
  carries the 10 newest posts with their full text, but not the author's slug,
  which the walk needs to match a post to a creator. So it cannot replace the
  newest-posts query as it is.
- **Extra headers on the browser**: the fetch ladder's browser step set the
  headers of a page load on every request (`extraHTTPHeaders`). They then went
  out with the check's own script and its requests too, and Vercel never let
  that browser through (`ladderBrowserProbe.ts --page-load-headers`).

## What was built

The shared browser starts with the flag. An API request that a bot check
stops is opened in the browser, which waits for the check to pass, reads the
answer, and keeps the site's cookies for the next request (`passProbe.ts`:
the first visit makes two requests and takes about 2 seconds, a visit with the
kept cookies makes one request and takes 0.4 seconds). `readerProbe.ts` runs
the page reader's own code with Jina switched off:

| Read, from the services box's address | Time | Result |
|---|---|---|
| The 50 newest posts, first request | 2.6 s | 49 posts |
| The 50 newest posts, next requests | 1.1 to 1.4 s | 49 posts |
| An author's listing | 0.9 s | name and 3 posts |
| A post, through `readPage` | 0.5 s | 30,179 characters, read through the forum's API |
| A topic page, through the fetch ladder | 5.8 s | 3,315 characters, via the headless browser |

## Does it help beyond the EA Forum

The services recorded every page read from 2026-11-12 to 2026-11-19 in the
table `page_reads`. In that week Jina served 324 of the 4,493 page reads, on
167 sites (`jinaRescuedPages.ts`). I took one page from each of the 60 sites
with the most such reads and ran the fetch ladder on them twice at the same
time, from the services box's address: once as on main and once with this
change (`ladderComparison.ts`).

| | main | this change |
|---|---|---|
| Pages read, of 60 | 22 | 30 |
| Read by the browser step | 0 | 5 |

Main reads 22 of them today although Jina had to read all of them last week,
mostly because the Wayback Machine has a snapshot by now. With this change the
browser step read 5 pages, where main's browser step read none. Four of them
main could not read at all, and the fifth it read from a Wayback snapshot. One
of the five, nbcpalmsprings.com, stands behind Vercel's check like the EA
Forum and passed it in 1.5 seconds. The other four answered the browser
directly, now that it neither announces automation nor sends the forced
headers. I did not separate those two causes. The remaining differences (five
pages gained through a Wayback snapshot, one lost) came from the Wayback
Machine answering one run and not the other, which is chance.

Seven of the 60 pages stand behind Cloudflare's challenge, and it never let
our browser through (`botCheckKinds.ts`). The browser step first waited 20
seconds on each of them. It now waits 8, because Vercel's check passed within
2.3 seconds in every test.

So 30 of the 60 pages still need Jina: Facebook, Instagram, Reddit, the
Cloudflare sites and others.

## Running our own copy of Jina Reader

Jina publishes its reader under the Apache licence, with a ready Docker image
(`ghcr.io/jina-ai/reader:oss`, 5.2 GB). It runs without keys. I ran it on the
devbox with its whole traffic leaving from the services box's address, so it
saw the sites as it would if it ran there (`selfHostedJina.ts` says how). Each
page got Jina's default engine first and then its browser engine.

**The EA Forum.** With Jina's default settings our copy got the bot check's
page for the post, the topic page and the API, from both engines. Hosted Jina
never had that problem, because its Google Cloud addresses are not checked.
With a longer wait (`x-timeout: 25`) its browser engine got through, which is
the same trick PR #759 builds in. So for the EA Forum our copy adds nothing.

**The 60 pages that only hosted Jina could read last week:**

| | Our ladder with PR #759 | Our copy of Jina |
|---|---|---|
| Pages read, of 60 | 30 | 21 |
| Of those, read live rather than from a Wayback snapshot | 6 | 21 |
| Pages the other one could not read | 19 | 10 |

Together the two read 40 of the 60. Our copy read 11 pages with its default
engine, which sends a plain request with Chrome's TLS fingerprint and headers
(curl-impersonate), and 10 with its browser engine. The 20 pages neither
could read include Reddit, X, TikTok, Politico, ESPN and CNBC.

Hosted Jina read all 60. What our copy lacks is in Jina's code
(`src/api/crawler.ts`): when a page comes back nearly empty or with an error
status, hosted Jina retries it through a residential proxy pool it pays for
(Thordata). The open-source copy has that code but no pool.

**Cost.** With four pages at a time the container used 1.7 to 4.2 GB of
memory and up to 6.7 processor cores. A page took 13.5 seconds at the median.
The services box has 8 GB and 4 cores for every service together.

## How the tests left from the services box's address

Nothing ran on the services box except one read-only test at the end. The
other tests ran on the devbox, with their traffic sent through the box:
`ssh -N -D 127.0.0.1:1081 root@<services box>` opens a SOCKS forward, and
`uv run --python 3.12 --with pproxy pproxy -l http://127.0.0.1:1082 -r socks5://127.0.0.1:1081`
turns it into an HTTP proxy. With `HTTPS_PROXY` and `https_proxy` set to it,
Bun's `fetch` and Chromium both leave from the box's address, so the page
reader's unchanged code can be tested from there.
