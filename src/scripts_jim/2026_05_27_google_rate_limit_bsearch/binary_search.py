"""
Binary search for the minimum sustained interval at which SearXNG -> google
returns >0 results without tripping Google's rate limit.

Test: send N sequential, diverse queries spaced INTERVAL seconds apart.
SUCCESS = no rate-limit signal observed across the whole run.
FAIL = any of:
  - SearXNG's docker logs show SearxEngineTooManyRequestsException for google
  - SearXNG /stats/errors gains a SearxEngineTooManyRequestsException for google
  - SearXNG logs an AccessDenied / CAPTCHA event for google
  - More than ALLOWED_ZERO_RESULTS sequential 0-result responses (soft signal:
    Google likely served a CAPTCHA page that the parser couldn't read)

On FAIL we honor `suspended_time=N` from SearXNG before the next test (no
hammering). When suspended_time is not parseable, fall back to DEFAULT_BLOCK_S.

Algorithm:
  Phase 1: binary-search interval in [LOW_S, HIGH_S], 2s grid, with PHASE1_HITS
  per probe. This brackets the boundary fast.
  Phase 2: confirm PHASE2_HITS at the proposed minimum. If it fails, step up
  by 2s and retry until it sticks.

Run:
  uv run src/scripts_jim/2026_05_27_google_rate_limit_bsearch/binary_search.py
"""
import json
import math
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")
LOG_DIR = Path(__file__).parent
RUN_LOG = LOG_DIR / "run.log"
SUMMARY_FILE = LOG_DIR / "summary.json"

# Search range and precision (seconds, all integers on a 2s grid).
LOW_S = 4
HIGH_S = 30
PRECISION_S = 2

# Phase 1: cheap probe to bracket the boundary.
PHASE1_HITS = 20
# Phase 2: full confirmation run.
PHASE2_HITS = 50

# Safety knobs.
SUSPENDED_BUFFER_S = 30  # extra wait beyond what suspended_time tells us
DEFAULT_BLOCK_S = 200    # used when we can't read suspended_time
INTER_TEST_SETTLE_S = 15 # short settle window between consecutive clean tests
SEARXNG_HTTP_TIMEOUT_S = 12
ALLOWED_ZERO_RESULTS = 3  # consecutive 0-result responses we tolerate before
                          # declaring "Google is blocking" even without a log

# Phase 2 escalation cap so we don't loop forever if the system shifts.
PHASE2_MAX_RETRIES = 5

# Detection patterns in docker logs (engines.google scope).
GOOGLE_BLOCK_PATTERNS = (
    "Too many request",
    "TooManyRequests",
    "AccessDenied",
    "CAPTCHA",
    "captcha",
)

# Diverse query pool. Each test pulls a fresh slice so no query repeats within
# a run (avoids SearXNG-side caching giving a false win).
QUERY_TOPICS = [
    "trump tariff steel 2026", "biden inflation 2026", "china taiwan invasion threat",
    "climate change ocean temperature record", "elon musk neuralink demo",
    "openai gpt5 announcement", "ukraine drone strikes kursk",
    "fed interest rate decision 2026", "supreme court abortion ruling 2026",
    "covid origin lab leak report", "amazon rainforest deforestation 2026",
    "ev tesla recall 2026", "israel gaza ceasefire talks", "uk election labour win",
    "boeing 737 safety report 2026", "apple vision pro sales", "russia sanctions oil",
    "north korea missile test 2026", "venezuela election results 2026",
    "argentina milei economy", "japan earthquake 2026 noto", "india election modi",
    "germany afd election", "france macron pension reform", "iran israel attack",
    "south africa election anc", "indonesia election prabowo", "brazil floods 2026",
    "spain elections sanchez", "italy meloni migration", "saudi crown prince visit",
    "australia bushfire warning", "canada wildfire smoke", "mexico cartel crackdown",
    "turkey lira inflation", "egypt suez canal traffic", "poland border ukraine",
    "south korea opposition leader", "philippines south china sea", "vietnam factory output",
    "thailand election results", "malaysia anwar policy", "singapore election results",
    "new zealand election labour", "ireland sinn fein", "scotland independence vote",
    "netherlands election results", "belgium government formation", "greece tourism record",
    "portugal socialist government",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with RUN_LOG.open("a") as fp:
        fp.write(line + "\n")


def build_queries(n: int, run_tag: str) -> list[str]:
    out = []
    for i in range(n):
        topic = QUERY_TOPICS[i % len(QUERY_TOPICS)]
        out.append(f"{topic} {run_tag} q{i}")
    return out


def fetch_one(query: str) -> dict:
    """Returns {'status': int|None, 'results': int|None, 'error': str|None}."""
    url = f"{SEARXNG_URL}/search?q={urllib.parse.quote(query)}&format=json&engines=google"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; RateLimitProbe/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=SEARXNG_HTTP_TIMEOUT_S) as r:
            status = r.status
            data = json.loads(r.read())
            return {"status": status, "results": len(data.get("results", [])), "error": None}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "results": None, "error": f"HTTPError {e.code}"}
    except Exception as e:
        return {"status": None, "results": None, "error": f"{type(e).__name__}: {e}"}


def docker_log_lines_since(since_iso: str) -> list[str]:
    try:
        out = subprocess.check_output(
            ["docker", "logs", "--since", since_iso, "searxng"],
            stderr=subprocess.STDOUT,
            timeout=10,
        ).decode("utf-8", errors="ignore")
        return out.splitlines()
    except Exception as e:
        log(f"  docker logs failed: {e}")
        return []


def extract_suspended_time_s(lines: list[str]) -> int | None:
    """Parse the largest suspended_time=N from the relevant lines."""
    max_secs = 0
    for ln in lines:
        if "suspended_time=" not in ln:
            continue
        # Tolerant parse: find the number after "suspended_time="
        idx = ln.find("suspended_time=") + len("suspended_time=")
        digits = []
        for ch in ln[idx:]:
            if ch.isdigit():
                digits.append(ch)
            else:
                break
        if digits:
            n = int("".join(digits))
            if n > max_secs:
                max_secs = n
    return max_secs if max_secs > 0 else None


def detect_google_block(since_iso: str) -> tuple[bool, int | None, str]:
    """Returns (blocked, suspended_time_s_or_None, reason)."""
    lines = docker_log_lines_since(since_iso)
    google_lines = [ln for ln in lines if "engines.google" in ln or "searx.engines.google" in ln]
    block_lines = [
        ln for ln in google_lines
        if any(p in ln for p in GOOGLE_BLOCK_PATTERNS)
    ]
    if not block_lines:
        return False, None, ""
    suspended_s = extract_suspended_time_s(block_lines)
    reason = block_lines[0][-200:]
    return True, suspended_s, reason


def fetch_stats_errors() -> dict:
    url = f"{SEARXNG_URL}/stats/errors"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def google_has_too_many_in_stats() -> tuple[bool, int | None]:
    data = fetch_stats_errors()
    errs = data.get("google", [])
    suspended_s = None
    any_too_many = False
    for e in errs:
        cls = e.get("exception_classname") or ""
        params = e.get("log_parameters") or []
        joined = " ".join(str(p) for p in params)
        if "TooManyRequests" in cls or "Too many request" in joined:
            any_too_many = True
            ts = extract_suspended_time_s([joined])
            if ts and (suspended_s is None or ts > suspended_s):
                suspended_s = ts
    return any_too_many, suspended_s


def ensure_clean_state() -> None:
    """Make sure google isn't currently suspended before starting a test."""
    while True:
        too_many, suspended_s = google_has_too_many_in_stats()
        if not too_many:
            # extra sanity: confirm google can return >0 results right now
            probe = fetch_one("wikipedia article overview")
            if (probe.get("results") or 0) > 0:
                return
            log(f"  pre-test canary returned 0 results (status={probe.get('status')}); waiting {DEFAULT_BLOCK_S}s")
            time.sleep(DEFAULT_BLOCK_S)
            continue
        wait_s = (suspended_s or DEFAULT_BLOCK_S) + SUSPENDED_BUFFER_S
        log(f"  google currently suspended in /stats/errors; waiting {wait_s}s before test")
        time.sleep(wait_s)


def run_test(interval_s: int, target_hits: int, label: str) -> dict:
    """Returns {ok: bool, hits: int, suspended_s: int|None, reason: str}."""
    run_tag = f"r{int(time.time()) % 100000}"
    queries = build_queries(target_hits + 4, run_tag)  # +4 extras so we always
                                                       # have unique queries

    ensure_clean_state()
    start_iso = utc_now_iso()
    log(f"  {label}: starting {target_hits} hits @ {interval_s}s interval (run_tag={run_tag})")

    consecutive_zeros = 0
    next_start = time.time()
    for i in range(target_hits):
        # Pace on request-start times: the user's "interval" is the gap between
        # consecutive request starts, not finish-to-next-start. This is the
        # quantity that maps to Google's per-second request rate.
        wait_until = next_start - time.time()
        if wait_until > 0:
            time.sleep(wait_until)
        q = queries[i]
        t0 = time.time()
        next_start = t0 + interval_s
        r = fetch_one(q)
        latency_ms = int((time.time() - t0) * 1000)
        results = r.get("results")

        # Print one-line per hit so logs are auditable.
        log(f"    hit {i+1}/{target_hits} q='{q[:40]}…' status={r.get('status')} results={results} {latency_ms}ms err={r.get('error')}")

        # Hard fail signals from logs/stats.
        blocked, suspended_s_log, reason = detect_google_block(start_iso)
        if blocked:
            log(f"  FAIL: google rate-limit signal in logs @ hit {i+1}: {reason}")
            return {"ok": False, "hits": i + 1, "suspended_s": suspended_s_log, "reason": "log: " + reason}
        too_many, suspended_s_stats = google_has_too_many_in_stats()
        if too_many:
            log(f"  FAIL: google has TooManyRequests in /stats/errors @ hit {i+1}")
            return {"ok": False, "hits": i + 1, "suspended_s": suspended_s_stats, "reason": "stats: TooManyRequests"}

        # Soft fail: sustained 0 results.
        if (results or 0) == 0:
            consecutive_zeros += 1
            if consecutive_zeros >= ALLOWED_ZERO_RESULTS:
                log(f"  FAIL: {consecutive_zeros} consecutive 0-result responses @ hit {i+1} (likely silent block)")
                return {"ok": False, "hits": i + 1, "suspended_s": None, "reason": f"{consecutive_zeros} consecutive zeros"}
        else:
            consecutive_zeros = 0

    log(f"  {label}: SUCCESS ({target_hits} hits, no rate-limit signal)")
    return {"ok": True, "hits": target_hits, "suspended_s": None, "reason": ""}


def cooldown_after_fail(result: dict) -> None:
    wait_s = (result.get("suspended_s") or DEFAULT_BLOCK_S) + SUSPENDED_BUFFER_S
    log(f"  cooldown after fail: {wait_s}s")
    time.sleep(wait_s)


def settle_after_clean_run() -> None:
    log(f"  inter-test settle {INTER_TEST_SETTLE_S}s")
    time.sleep(INTER_TEST_SETTLE_S)


def snap_to_grid(x: float) -> int:
    """Round x up to the next multiple of PRECISION_S, then clamp to [LOW_S, HIGH_S]."""
    g = int(math.ceil(x / PRECISION_S) * PRECISION_S)
    return max(LOW_S, min(HIGH_S, g))


def write_summary(d: dict) -> None:
    SUMMARY_FILE.write_text(json.dumps(d, indent=2))


def main() -> None:
    log(f"=== START binary search (low={LOW_S}s, high={HIGH_S}s, precision={PRECISION_S}s, phase1={PHASE1_HITS}, phase2={PHASE2_HITS}) ===")

    low = LOW_S
    high = HIGH_S
    history: list[dict] = []

    # Phase 1: bracket the boundary
    iteration = 0
    while high - low > PRECISION_S:
        iteration += 1
        mid = snap_to_grid((low + high) / 2)
        # Avoid degenerate mids that equal low (when range is tight).
        if mid == low:
            mid = snap_to_grid(low + PRECISION_S)
        log(f"\n--- Phase 1 iter {iteration}: low={low}s high={high}s  testing mid={mid}s ---")
        r = run_test(mid, PHASE1_HITS, f"phase1 mid={mid}s")
        history.append({"phase": 1, "iter": iteration, "interval_s": mid, **r})
        write_summary({"low": low, "high": high, "history": history, "status": "in_progress"})
        if r["ok"]:
            high = mid
            settle_after_clean_run()
        else:
            low = mid
            cooldown_after_fail(r)

    log(f"\n=== Phase 1 done: minimum safe interval (20-hit) = {high}s ===")

    # Phase 2: confirm 50 hits at high. If fails, escalate up the 2s grid.
    candidate = high
    final_ok = False
    for attempt in range(1, PHASE2_MAX_RETRIES + 1):
        log(f"\n--- Phase 2 attempt {attempt}: confirm {PHASE2_HITS} hits @ {candidate}s ---")
        r = run_test(candidate, PHASE2_HITS, f"phase2 conf={candidate}s")
        history.append({"phase": 2, "attempt": attempt, "interval_s": candidate, **r})
        write_summary({"low": low, "high": high, "candidate": candidate, "history": history, "status": "in_progress"})
        if r["ok"]:
            final_ok = True
            break
        cooldown_after_fail(r)
        candidate = snap_to_grid(candidate + PRECISION_S)
        if candidate > HIGH_S:
            log(f"  candidate would exceed HIGH_S={HIGH_S}s; giving up")
            break

    final = {
        "low": low,
        "high": high,
        "phase2_candidate": candidate,
        "phase2_passed": final_ok,
        "history": history,
        "status": "done",
        "answer_seconds": candidate if final_ok else None,
    }
    write_summary(final)
    if final_ok:
        log(f"\n=== FINAL ANSWER: {candidate}s passes {PHASE2_HITS} consecutive google hits ===")
    else:
        log(f"\n=== FINAL: could not confirm 50-hit success up to {HIGH_S}s (best 20-hit pass: {high}s) ===")


if __name__ == "__main__":
    main()
