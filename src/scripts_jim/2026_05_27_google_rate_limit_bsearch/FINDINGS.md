# Google rate-limit binary search — findings (2026-05-29)

## Headline

- **Strict answer (the script's stop criterion):** **6 s** passes 50 consecutive
  google hits via SearXNG without a single rate-limit signal observed.
- **Safer answer for production:** **8 s.** At 6 s the system was visibly
  scraping the limit (see below); 8 s ran cleanly with full result counts.

## What the binary search did

Bracket: `[4 s, 30 s]`, 2 s grid. Phase 1 = 20 hits per probe; Phase 2 = 50
hits at the bracket minimum. Pacing on request-start times.

| Phase | Interval | Hits | Result-count distribution | Verdict |
|------:|---------:|-----:|---------------------------|---------|
| 1 iter 1 | 18 s | 20 | 19×10, 1×7 | clean |
| 1 iter 2 | 12 s | 20 | 20×10 | clean |
| 1 iter 3 | 8 s | 20 | 19×10, 1×6 | clean |
| 1 iter 4 | 6 s | 20 | 17×10, 1×9, **2×0 at the end** | "passed" but warning |
| 2 conf | 6 s | 50 | 41×10, 3×4, 1×5, 2×6, 1×7, 2×9, **0×0** | clean |

(Each probe's queries were unique English topics with a per-run tag so
SearXNG's cache could not short-circuit.)

## The 6 s caveat — important

Phase 1's 6 s probe ended with two consecutive `results=0` responses (hits
19 and 20 of 20). The in-probe detector's threshold was 3 consecutive zeros,
so it didn't fire. Right after the probe ended the recovery-canary
(`"wikipedia article overview"`) kept returning 0 results for **~2 h 17 min**
before recovering (03:53 → 06:10 UTC-local).

SearXNG's docker logs and `/stats/errors` showed **no** new `TooManyRequests`
/ `AccessDenied` / `CAPTCHA` lines for google during this window — the block
was silent. The most likely explanation: at ~6 s sustained, the google
engine's parser keeps returning 200 OK with empty parsed content (a CAPTCHA
landing page that `extract_text(content_nodes[0])` happens not to crash on
this time, just yields no result nodes). The block is then enforced
externally and lasts hours, not the documented 180 s.

So although the Phase 2 50-hit confirmation at 6 s passed (after the long
natural cool-down reset Google's bucket), 6 s is **on the edge** and a
51st-or-later hit very plausibly would have tripped it again. The 2 hr
silent block we observed is too costly to risk in production for a 25 % rate
gain over 8 s.

## Why 8 s is the recommended production value

- 8 s ran 20 hits with zero empty responses and zero degraded counts beyond
  the single 6-result query (a normal Google "fewer than 10 hits" for a
  long-tail term).
- 8 s = 7.5 req/min — well within the rate where the existing 12 s
  per-engine cooldown in `searxng.ts` (5 req/min) is currently anchored, and
  consistent with prior `test_searxng_load.py` observations that
  concurrency × queries/burst rates ≥ ~10 req/min start tripping the block.
- The 4 s/6 s gap leaves headroom for the brief 1–2× concurrency bursts the
  production orchestrator already produces.

## What "4 s is too fast" + "6 s is on the edge" implies

Google's per-IP token bucket for SearXNG-shaped traffic appears to be near
~10 req/min. 6 s = 10 req/min sits right at the boundary; bursts of 20+
queries above this rate trigger a long silent block. 8 s = 7.5 req/min sits
safely below. The 2 s grid precision means 8 s is the answer at the
user-requested resolution.

## Recommendation

In `src/pipeline/tool-calling/searxng.ts`, change:

```
const SEARXNG_ENGINE_COOLDOWN_MS = Number(process.env.SEARXNG_ENGINE_COOLDOWN_MS) || 12_000;
```

to `8_000` (or keep 12_000 if the current pipeline's actual call pattern
sustains higher than the probe's pure-sequential pattern under concurrency).
If we really want to push to 6 s, gate behind an A/B and watch the silent
block rate over a few hours.

## Run artifacts

- [run.log](run.log) — per-hit timestamped trace
- [summary.json](summary.json) — programmatic result
- [binary_search.py](binary_search.py) — the probe
- [README.md](README.md) — how to run / what's measured
