# Google rate-limit binary search

Find the minimum sustained interval at which SearXNG → google returns >0
results without tripping Google's rate limit.

## Test definition

- **Probe** = N sequential, diverse queries spaced INTERVAL seconds apart
  (request-start → next request-start, not finish-to-next-start).
- **SUCCESS** = no rate-limit signal observed across the whole probe.
- **FAIL** = any of:
  - SearXNG docker logs gain `SearxEngineTooManyRequestsException` for google
  - `/stats/errors` gains a `TooManyRequests*` exception for google
  - `AccessDenied` / `CAPTCHA` lines for google in docker logs
  - ≥3 consecutive 0-result responses (soft signal — Google likely served a
    CAPTCHA page the parser couldn't read)

When the probe fails we honor `suspended_time=N` from SearXNG before the next
probe; falls back to 200 s if not parseable. +30 s buffer on top.

## Algorithm

- **Phase 1** — bracket the boundary fast with `PHASE1_HITS=20` per probe on a
  2 s grid between `LOW_S=4` and `HIGH_S=30`. Standard integer binary search.
- **Phase 2** — at the Phase 1 answer, run a `PHASE2_HITS=50` confirmation
  probe. If that fails, step up by 2 s and retry (up to `PHASE2_MAX_RETRIES`).

## Detection rationale

SearXNG's google plugin parses Google's HTML response. When Google rate-limits
or CAPTCHAs us, two things happen in roughly this order:

1. SearXNG records a `SearxEngineTooManyRequestsException` (with
   `suspended_time=N`) → engine auto-suspended for N s, visible in
   `/stats/errors` and docker logs.
2. While suspended, `/search?engines=google` returns 200 OK with `results=[]`.

So "results=0" alone is not a 4xx — it could be a legitimately empty Google
query. The authoritative 4xx-equivalent signal is the
`SearxEngineTooManyRequestsException` line in docker logs (or the parser
"list index out of range" crash that also accompanies a CAPTCHA page). We use
the docker logs grep as the primary signal and consecutive zeros as a soft
fallback.

## Files

- [binary_search.py](binary_search.py) — the script
- `run.log` — timestamped progress log (one line per hit)
- `summary.json` — final answer + per-iteration history
- `stdout.log` — raw stdout/stderr from the background run

## Run

```bash
uv run src/scripts_jim/2026_05_27_google_rate_limit_bsearch/binary_search.py
```

## Output

`summary.json.answer_seconds` is the minimum interval that passed 50
consecutive google hits without tripping the rate limit, on a 2 s grid.
