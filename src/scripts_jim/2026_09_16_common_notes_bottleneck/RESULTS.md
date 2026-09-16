# Where the Common Notes feed pipeline spends its day (GOO-169)

Measured on 2026-09-16, 00:00 to 15:12 UTC, the first full day on the cheap
pipeline (Muse Spark, PR 463). Sources: `everything_items` timestamps and
`everything_pipeline_runs` rows (pullItems.ts, analyze.py), the timing of
every step in all 87 GitHub Actions runs of that window (runTimeBudget.py
over the run logs), and the claim-check service's journal on the services box.

## The short answer

Money is not the limit and the services are not the limit. Wall-clock time
is, and three quarters of it is wasted.

- Spend: $8.59 of the $40 feed budget by 15:12 UTC. The pacing rule says the
  budget affords about 200 posts a day and asks for one post every 5 minutes.
  A run takes 8.7 minutes on average, so every run ends with "next run at once,
  the pipeline is behind its schedule". Pacing never waits; the pipeline is
  simply slower than the money.
- The services box is idle: load average 0.1, and every one of the 87 runs
  found the claim checker with 0 calls in flight when it started. The X
  pipeline sent it no tweets today either.
- Output: 35 feed items finished (plus 9 declined by the gate), 43 notes.

## The 912 minutes of the window

| minutes | share | what |
|---:|---:|---|
| 209 | 23% | processing the 25 items that finished with notes or no-notes (the productive part) |
| 168 | 18% | 52 attempts at YouTube videos that ended in "No transcript available", about 3.2 min each |
| 138 | 15% | the creator walk, which runs in nearly every run because the queue is empty after every item (45 walks, 3.1 min each) |
| 144 | 16% | after the walk: mostly the all-time-top-posts refresh for joerogan, which timed out in 28 runs at about 4 min each and is retried on every run because a failed refresh is never stamped |
| 139 | 15% | gaps between runs: pg_cron's one-minute tick plus GitHub's dispatch, about 1.6 min per run, and one 45-minute hole after a failed run at 00:46 |
| 71 | 8% | runner setup before the pipeline starts (checkout, bun install, apt, yt-dlp) |
| 22 | 2% | health check, triage, pacing, gate-declined items, tail |
| 5 | 1% | 9 items the gate declined |

## Inside a successful item (34 items, mean 10.3 min)

| phase | mean minutes |
|---|---:|
| fetch and claim extraction | 3.0 |
| rating with web research | 1.8 |
| fact-checking the claims that need it | 4.9 |

Extraction and rating are serial model calls and nothing else runs meanwhile.
During the checking phase the checker takes 3 to 8 checks a minute with the 4
slots feed work may use (6 slots, 2 reserved for readers), so a single item
already fills those slots during its checking phase, but only for half its
life. Two or three items side by side would roughly double throughput before
the checker's concurrency has to rise.

## The failing YouTube videos

29 distinct videos failed with "No transcript available" since 2026-09-15.
None is an all-time-top pick; all came from the recent-uploads listing. Most
were published 2 to 8 days before the attempt, so this is not auto-captions
that have not been generated yet. 16 of them have used all three attempts
(6 hours apart) and failed identically each time, which says the videos have
no captions at all rather than a flagged proxy IP. The creators are
kenforrest, theelephantgraveyardmusic, bentalkstalent, magmidt, crunchyroll,
katunews and channel5youtube. Each attempt costs 3 yt-dlp calls through the
residential proxy at about a minute each, plus a whole run's overhead.

## What is not a bottleneck

- The daily spend cap and the pacing rule (they never bind).
- Extraction and claim-check service capacity (idle between items).
- Runner setup steps (under a minute per run; the yt-dlp install is the
  biggest at 35 seconds).

## Correction, evening of 2026-09-16: the "no captions" videos have captions

Jim asked for URLs and whether they still fail. Four throwaway GitHub Actions
runs (`.github/workflows/debug-yt-subs.yml` on this branch, runs 35144623067,
35146250046, 35147991618, 35148154677) ran the same yt-dlp calls the worker
runs, through the residential proxy, on five of the failing videos and on one
video the pipeline had fetched successfully at 13:54 that day.

What they showed:

- **Every video, including the one that worked at 13:54, answered "has no
  subtitles" through the proxy at 20:10.** So "No transcript available" is
  not a property of the videos.
- **The cause is inside yt-dlp's YouTube handling.** yt-dlp's default path
  asks YouTube's player API as the visionOS, TV or Android app. Through the
  proxy those requests time out: three internal retries of about 20 seconds
  each, then "Unable to download API page", then "has no subtitles". That is
  the 85 seconds per call. A JS runtime (deno), a longer socket timeout, and
  other player clients change nothing. Without the proxy YouTube answers
  "Sign in to confirm you're not a bot" at once, as expected.
- **The web client sees the captions but throws them away.** With
  `player_client=web` yt-dlp finishes in 2 seconds and logs "Some web client
  subtitles require a PO Token which was not provided. They will be
  discarded". A PO token (YouTube's "proof of origin" token, which the real
  web player obtains by running YouTube's attestation JavaScript) is what the
  web client needs to download captions today.
- **With a PO token provider the captions download in 10 to 32 seconds.**
  The `bgutil-ytdlp-pot-provider` plugin plus its Docker container
  (`brainicism/bgutil-ytdlp-pot-provider`, which yt-dlp asks at
  127.0.0.1:4416) made both videos' English captions download through the
  proxy on the first try.
- **The proxy itself is healthy.** Plain HTTPS through it to ipify,
  example.com, youtube.com and the channel RSS feed all answered in 1 to 3
  seconds.

So the fix for the largest single waste is not "skip caption-less videos".
It is: run yt-dlp with the PO token provider (a container next to the worker
on GitHub and next to the intake service on the box) and use the web client
for per-video calls. Also, the code currently turns "could not reach YouTube"
into the content answer "no transcript"; the fetch should fail as a network
error instead, so a proxy outage looks like one.

The channel listings (creator walk and top-posts refresh) need no proxy at
all: the same joerogan listing that timed out through the proxy 28 times took
2.7 seconds without it from a GitHub runner, and 5.6 seconds from the devbox.
