# /// script
# dependencies = ["requests", "trafilatura", "python-dotenv", "warcio", "patchright"]
# ///
"""Measures how many of the failed sources each candidate tool recovers.

One subcommand per candidate, each writing data/candidate_<name>.json:

  jina         Jina Reader, a hosted service: GET https://r.jina.ai/<url> returns
               the page as markdown. Needs JINA_READER_API in .env.
  exa          Exa's /contents endpoint with live crawling, a hosted service we
               already pay for. Needs EXA_API_KEY. `exa_fallback` runs the same
               with livecrawl=fallback, which prefers Exa's cached copy.
  wayback      The Wayback Machine's official CDX API, throttled to one request a
               second with backoff, then the raw snapshot ("id_" flag).
  commoncrawl  Common Crawl's index API for the two newest crawls, then a ranged
               read of the WARC record from data.commoncrawl.org.
  openrouter   Claude's server-side web_fetch tool through OpenRouter, capped at
               4000 content tokens. Runs on a fixed sample because each call costs
               tokens. Needs OPENROUTER_TESTING_KEY.
  patchright   Patchright, a Playwright fork patched to hide automation, headless
               Chromium from this VPS. Run `uv run --with patchright patchright
               install chromium` once first.

A URL counts as recovered when the tool returns at least 300 characters of
readable text that is not a login or bot wall. That is the same bar the
pipeline's classifyContent applies.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/03_test_candidates.py <name> [--limit N]
"""
import json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests, trafilatura
from dotenv import load_dotenv

HERE = Path(__file__).parent
DATA = HERE / "data"
load_dotenv(HERE.parents[2] / ".env")
MIN_GOOD_CHARS = 300
TIMEOUT = 40
WALL_PATTERNS = ["log in or sign up", "please wait for verification", "javascript is not available", "captcha",
                 "verifying you are human", "checking your browser", "access denied", "just a moment", "enable javascript"]
DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
OPENROUTER_SAMPLE = 60


def looks_like_wall(text: str) -> bool:
    head = text.lower()[:2000]
    return sum(p in head for p in WALL_PATTERNS) >= 2


def verdict(text: str | None, html: bool = False) -> dict:
    text = text or ""
    readable = (trafilatura.extract(text) or "") if html else text
    return {"chars": len(readable), "wall": looks_like_wall(readable), "good": len(readable) >= MIN_GOOD_CHARS and not looks_like_wall(readable),
            "head": re.sub(r"\s+", " ", readable)[:200]}


def load_urls(limit: int | None) -> list[str]:
    urls = [r["url"] for r in json.loads((DATA / "diagnosis.json").read_text())] if (DATA / "diagnosis.json").exists() else None
    if urls is None:
        seen = {}
        for name in ["x_verifier_failures_14d.json", "everything_verifier_failures_14d.json"]:
            for r in json.loads((DATA / name).read_text()):
                seen.setdefault(r["url"], True)
        urls = list(seen)
    return urls[:limit] if limit else urls


def run_parallel(name: str, urls: list[str], fn, workers: int = 6):
    def one(url):
        try:
            r = fn(url)
        except Exception as e:
            r = {"error": f"{type(e).__name__}: {str(e)[:200]}", "good": False}
        print(f"{name:12s} good={r.get('good')!s:5} {r.get('status', '')!s:>4} {url[:90]}", file=sys.stderr, flush=True)
        return {"url": url} | r
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(one, urls))
    (DATA / f"candidate_{name}.json").write_text(json.dumps(results, indent=1))
    print(f"{name}: {sum(r['good'] for r in results)}/{len(results)} recovered")


# --- Jina Reader ---------------------------------------------------------------
JINA_FAILURE_MARKS = ["Warning: Target URL returned error", "requiring CAPTCHA", "Title: Just a moment", "Log into Facebook",
                      "Title: Page not found", "cksync"]


def jina(url: str) -> dict:
    """Jina answers 200 even when the site answered 404 or 403, or served a login
    or challenge page. It says so in a Warning line of its own header block, and
    a challenge page shows in the title, so those answers count as failures."""
    r = requests.get(f"https://r.jina.ai/{url}", timeout=TIMEOUT,
                     headers={"Authorization": f"Bearer {os.environ['JINA_READER_API']}", "X-Return-Format": "markdown"})
    if not r.ok:
        return {"status": r.status_code, "good": False, "error": r.text[:300]}
    header_block = r.text[:1500]
    marks = [m for m in JINA_FAILURE_MARKS if m in header_block]
    v = verdict(r.text)
    return {"status": r.status_code, "jina_warnings": marks, "header": header_block[:600]} | v | {"good": v["good"] and not marks}


# --- Exa contents -----------------------------------------------------------------
def exa_batch(urls: list[str], livecrawl: str) -> list[dict]:
    r = requests.post("https://api.exa.ai/contents", timeout=90, headers={"x-api-key": os.environ["EXA_API_KEY"]},
                      json={"urls": urls, "text": {"maxCharacters": 20000}, "livecrawl": livecrawl})
    r.raise_for_status()
    body = r.json()
    by_url = {res.get("url"): res for res in body.get("results", [])}
    out = []
    for u in urls:
        res = by_url.get(u)
        status = next((s for s in body.get("statuses", []) if s.get("id") == u), {})
        out.append({"url": u, "status": status.get("status"), "exa_error": (status.get("error") or {}).get("tag")} |
                   (verdict(res.get("text")) if res else {"good": False, "chars": 0}))
    return out


def exa(urls: list[str], livecrawl: str = "always"):
    """livecrawl "always" fetches the live page; "fallback" serves Exa's own cached
    copy when it has one and crawls only otherwise."""
    name = "exa" if livecrawl == "always" else f"exa_{livecrawl}"
    results = []
    for i in range(0, len(urls), 10):
        batch = urls[i:i + 10]
        try:
            results += exa_batch(batch, livecrawl)
        except Exception as e:
            results += [{"url": u, "error": f"{type(e).__name__}: {str(e)[:200]}", "good": False} for u in batch]
        print(f"exa {i + len(batch)}/{len(urls)} recovered so far {sum(r['good'] for r in results)}", file=sys.stderr, flush=True)
    (DATA / f"candidate_{name}.json").write_text(json.dumps(results, indent=1))
    print(f"{name}: {sum(r['good'] for r in results)}/{len(results)} recovered")


# --- Wayback CDX API (official) ----------------------------------------------------
def polite_get(url: str, params: dict | None = None, headers: dict | None = None):
    """One request a second with exponential backoff on 429, as the Internet Archive asks."""
    delay = 3
    for attempt in range(5):
        r = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
        if r.status_code != 429:
            return r
        time.sleep(delay)
        delay *= 2
    return r


def wayback(urls: list[str]):
    results = []
    for url in urls:
        row = {"url": url, "good": False}
        try:
            cdx = polite_get("https://web.archive.org/cdx/search/cdx",
                             {"url": url, "output": "json", "limit": 1, "filter": "statuscode:200", "from": "2023", "fl": "timestamp,original"})
            row["cdx_status"] = cdx.status_code
            rows = cdx.json() if cdx.ok and cdx.text.strip() else []
            if len(rows) > 1:
                ts, original = rows[1]
                row["snapshot"] = f"https://web.archive.org/web/{ts}id_/{original}"
                time.sleep(1)
                snap = polite_get(row["snapshot"], headers={"User-Agent": DESKTOP_UA})
                row["status"] = snap.status_code
                if snap.ok:
                    row |= verdict(snap.text, html=True)
            else:
                row["status"] = "no snapshot"
        except Exception as e:
            row["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        print(f"wayback      good={row['good']!s:5} {row.get('status', '')!s:>12} {url[:90]}", file=sys.stderr, flush=True)
        results.append(row)
        time.sleep(1)
    (DATA / "candidate_wayback.json").write_text(json.dumps(results, indent=1))
    print(f"wayback: {sum(r['good'] for r in results)}/{len(results)} recovered")


# --- Common Crawl index + WARC range read -------------------------------------------
def commoncrawl_indexes() -> list[str]:
    return [c["cdx-api"] for c in requests.get("https://index.commoncrawl.org/collinfo.json", timeout=TIMEOUT).json()[:2]]


def commoncrawl_one(url: str, indexes: list[str]) -> dict:
    from io import BytesIO
    from warcio.archiveiterator import ArchiveIterator
    for api in indexes:
        r = polite_get(api, {"url": url, "output": "json", "limit": 1, "filter": "status:200"})
        if not r.ok or not r.text.strip():
            continue
        rec = json.loads(r.text.splitlines()[0])
        offset, length = int(rec["offset"]), int(rec["length"])
        warc = requests.get(f"https://data.commoncrawl.org/{rec['filename']}", timeout=TIMEOUT,
                            headers={"Range": f"bytes={offset}-{offset + length - 1}"})
        for record in ArchiveIterator(BytesIO(warc.content)):
            if record.rec_type == "response":
                return {"status": 200, "index": api.rsplit("/", 1)[-1], "captured": rec.get("timestamp")} | verdict(record.content_stream().read().decode("utf-8", "replace"), html=True)
    return {"status": "no capture", "good": False}


def commoncrawl(urls: list[str]):
    indexes = commoncrawl_indexes()
    run_parallel("commoncrawl", urls, lambda u: commoncrawl_one(u, indexes), workers=2)


# --- Claude's server-side web_fetch through OpenRouter ---------------------------------
def openrouter(url: str) -> dict:
    r = requests.post("https://openrouter.ai/api/v1/chat/completions", timeout=120,
                      headers={"Authorization": f"Bearer {os.environ['OPENROUTER_TESTING_KEY']}"},
                      json={"model": "anthropic/claude-sonnet-5", "max_tokens": 1200,
                            "messages": [{"role": "user", "content": f"Fetch {url} and reply with the first 800 words of the page's main text, verbatim. If the fetch fails, reply exactly FETCH_FAILED followed by the error."}],
                            "tools": [{"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 1, "max_content_tokens": 4000}]})
    body = r.json()
    if not r.ok:
        return {"status": r.status_code, "good": False, "error": json.dumps(body)[:300]}
    text = body["choices"][0]["message"].get("content") or ""
    failed = text.strip().startswith("FETCH_FAILED") or "FETCH_FAILED" in text[:200]
    cost = body.get("usage", {}).get("cost")
    return {"status": 200, "cost": cost, "failed_reported": failed} | (verdict(text) if not failed else {"good": False, "chars": 0, "head": text[:200]})


# --- Patchright, stealth headless Chromium --------------------------------------------
def patchright_one(url: str) -> dict:
    from patchright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chromium")
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
        page = context.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(2500)
            status = resp.status if resp else None
            return {"status": status} | verdict(page.content(), html=True)
        finally:
            browser.close()


if __name__ == "__main__":
    name = sys.argv[1]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    urls = load_urls(limit)
    if name == "jina":
        run_parallel("jina", urls, jina, workers=4)
    elif name == "exa":
        exa(urls)
    elif name == "exa_fallback":
        exa(urls, livecrawl="fallback")
    elif name == "wayback":
        wayback(urls)
    elif name == "commoncrawl":
        commoncrawl(urls)
    elif name == "openrouter":
        step = max(1, len(urls) // OPENROUTER_SAMPLE)
        run_parallel("openrouter", urls[::step][:OPENROUTER_SAMPLE], openrouter, workers=4)
    elif name == "patchright":
        run_parallel("patchright", urls, patchright_one, workers=3)
    else:
        sys.exit(f"unknown candidate {name}")
