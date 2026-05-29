"""
Empirical concurrency test for the local SearXNG → Google rate-limit.

Background: SearXNG's google engine gets a 403 / CAPTCHA from Google when
sustained query rate is too high, then SearXNG suspends the engine for
180s-3600s (per `searx/engines/google.py` and the SearXNG docs:
https://docs.searxng.org/admin/searx.limiter.html). The suspension is binary —
the engine works fine then suddenly returns zero results across the board.

This script simulates the cheap-bot pipeline's load pattern:
  - N parallel workers (== `--concurrency` in localPipelineRunner)
  - Each worker repeats: 3 sequential searXNG queries (~2s apart) → sleep 25s
    → repeat. The 25s sleep approximates the non-search portion of one tweet
    (writer + judge + verifier LLM calls).

For each concurrency level it runs for DURATION seconds and reports:
  - total queries fired
  - zero-result count (Google-suspension marker)
  - error count
  - whether docker logs flagged a 403 / CAPTCHA during the run
  - the per-minute query rate at that concurrency

Usage:
  uv run src/scripts_jim/2026_05_27_cheap_bot_concurrency/test_searxng_load.py \
    --concurrency 3 --duration 180

Recommended workflow: start at concurrency=2, work up. Allow ≥4 minutes between
runs that triggered a 403 (the suspension is 180s + buffer).
"""
import argparse
import concurrent.futures
import json
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime
from threading import Lock

SEARXNG_URL = "http://localhost:8080"
ENGINES = "google"
QUERIES_PER_WORKER_BURST = 3
INTER_QUERY_SLEEP_S = 2.0
INTER_BURST_SLEEP_S = 25.0  # approximates writer + judge + verifier wall time

# A pool of generic-but-real queries we cycle through. Real cheap-bot queries
# are tweet-specific; using diverse English queries here keeps the test honest
# (cached results wouldn't trigger rate-limiting).
QUERY_POOL = [
    "Trump approval rating April 2026",
    "Iran Israel ceasefire negotiation 2026",
    "Netanyahu speech Knesset March 2026",
    "Epstein documents 2026 release",
    "Ukraine front breakthrough 2026",
    "Maduro Venezuela capture US 2026",
    "Charlie Kirk Utah shooting facts",
    "Massie ICE vote bill 2026",
    "DHS funding budget 2026",
    "covid vaccine update 2026",
    "Tesla recall safety 2026",
    "Polymarket Bitcoin prediction",
    "Saudi Arabia Iran drone attack",
    "Mamdani New York mayor race",
    "Trump Soros lawsuit RICO 2026",
    "Vance motorcade DC shooting",
    "Hegseth defense secretary tie color",
    "Brazil Lula deforestation 2026",
    "China Taiwan strait Hormuz",
    "Greta Thunberg climate Iran 2026",
    "AI generated video Tel Aviv",
    "Ariana Grande Selena Gomez story",
    "Russia cancer vaccine Enteromix",
    "Anthropic Vishal Sikka hire",
    "Strait of Hormuz yuan toll",
    "Apeldoorn anti-immigration protest",
    "Ben-Gvir death hoax fact check",
    "Polymarket French weather hairdryer",
    "Erika Kirk clown emoji satire",
    "Stella McCartney Katy Perry Met Gala",
]


def fetch_one(q: str) -> tuple[str, int | str]:
    url = f"{SEARXNG_URL}/search?q={urllib.parse.quote(q)}&format=json&engines={ENGINES}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.loads(r.read())
            return q, len(d.get("results", []))
    except Exception as e:
        return q, f"err:{type(e).__name__}"


def docker_logs_403_count(since_iso: str) -> int:
    """Count 403/CAPTCHA errors logged by the searxng container since `since_iso`."""
    try:
        out = subprocess.check_output(
            ["docker", "logs", "--since", since_iso, "searxng"],
            stderr=subprocess.STDOUT,
            timeout=5,
        ).decode("utf-8", errors="ignore")
        return sum(1 for ln in out.splitlines() if "AccessDenied" in ln or "403" in ln or "CAPTCHA" in ln)
    except Exception:
        return -1


def worker(worker_id: int, end_time: float, results: list, lock: Lock) -> None:
    qi = worker_id * 7  # offset starting query per worker to spread the pool
    while time.time() < end_time:
        burst_start = time.time()
        for _ in range(QUERIES_PER_WORKER_BURST):
            q = QUERY_POOL[qi % len(QUERY_POOL)]
            qi += 1
            t0 = time.time()
            res = fetch_one(q)
            t1 = time.time()
            with lock:
                results.append({
                    "worker": worker_id,
                    "ts_offset_s": round(t0 - START_TS, 1),
                    "query": q,
                    "result_count": res[1],
                    "latency_s": round(t1 - t0, 2),
                })
            if time.time() >= end_time:
                return
            time.sleep(INTER_QUERY_SLEEP_S)
        elapsed_in_burst = time.time() - burst_start
        time.sleep(max(0, INTER_BURST_SLEEP_S - elapsed_in_burst))


def run_test(concurrency: int, duration: int) -> dict:
    global START_TS
    START_TS = time.time()
    started_iso = datetime.utcnow().isoformat() + "Z"
    end_time = START_TS + duration
    results: list[dict] = []
    lock = Lock()

    print(f"\n=== Test: concurrency={concurrency}, duration={duration}s ===")
    print(f"Started at: {started_iso}")
    print(f"Pattern per worker: {QUERIES_PER_WORKER_BURST} queries × ~{INTER_QUERY_SLEEP_S}s apart, then {INTER_BURST_SLEEP_S}s rest")
    expected_qpm = concurrency * QUERIES_PER_WORKER_BURST * (60 / (INTER_BURST_SLEEP_S + QUERIES_PER_WORKER_BURST * INTER_QUERY_SLEEP_S))
    print(f"Expected sustained query rate: ~{expected_qpm:.1f}/min")

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(worker, i, end_time, results, lock) for i in range(concurrency)]
        for f in futures:
            f.result()

    elapsed = time.time() - START_TS
    total = len(results)
    zero = sum(1 for r in results if r["result_count"] == 0)
    errs = sum(1 for r in results if isinstance(r["result_count"], str))
    nonzero = total - zero - errs

    docker_403 = docker_logs_403_count(started_iso)

    # Zero-result rate over time (5 bins) — detects when rate-limiting kicks in
    bins = 5
    bin_size = elapsed / bins
    zero_rate_by_bin = []
    for b in range(bins):
        t_start = b * bin_size
        t_end = (b + 1) * bin_size
        in_bin = [r for r in results if t_start <= r["ts_offset_s"] < t_end]
        if in_bin:
            zr = sum(1 for r in in_bin if r["result_count"] == 0) / len(in_bin)
            zero_rate_by_bin.append((round(t_start, 0), round(t_end, 0), len(in_bin), round(zr * 100, 1)))

    summary = {
        "concurrency": concurrency,
        "duration_s": round(elapsed, 1),
        "total_queries": total,
        "nonzero": nonzero,
        "zero_result": zero,
        "errors": errs,
        "zero_result_pct": round(zero / total * 100, 1) if total else 0,
        "docker_403_count": docker_403,
        "actual_qpm": round(total / (elapsed / 60), 1),
        "zero_rate_by_bin": zero_rate_by_bin,
    }

    print("\n" + json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--duration", type=int, default=180)
    args = ap.parse_args()
    run_test(args.concurrency, args.duration)
