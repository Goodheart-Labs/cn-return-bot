# /// script
# dependencies = ["requests", "curl_cffi", "trafilatura"]
# ///
"""Re-fetches every failed source from this VPS to find out why it failed.

Two requests per URL, from a datacenter address like the one GitHub Actions has:
  plain      Python requests with the pipeline's desktop user agent and browser
             headers. Its TLS handshake looks like a script, the same as Bun's.
  curl_cffi  The same request through curl_cffi with impersonate="chrome", so
             the TLS and HTTP/2 handshake look like real Chrome. Everything else
             is equal, so the difference isolates TLS fingerprinting.

For each answer we keep the status, the headers that name the bot-defence
vendor, and the head of the body, and we count the readable characters that
trafilatura extracts. That is enough to sort every failure into a cause.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/02_diagnose.py
"""
import json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests, trafilatura
from curl_cffi import requests as cffi

HERE = Path(__file__).parent
DATA = HERE / "data"
TIMEOUT = 25
WORKERS = 8
MIN_GOOD_CHARS = 300
DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BROWSER_HEADERS = {
    "User-Agent": DESKTOP_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1", "DNT": "1",
}
VENDOR_HEADERS = ["server", "akamai-grn", "cf-ray", "cf-mitigated", "x-datadome", "x-datadome-cid", "x-iinfo", "x-cdn",
                  "x-amz-cf-id", "x-served-by", "via", "x-cache", "x-px", "x-reddit-loid", "x-vercel-id", "x-powered-by"]

# Signatures of the bot-defence products, checked against headers and body.
VENDOR_SIGNS = [
    ("akamai", lambda h, b: "akamai-grn" in h or "akamaighost" in h.get("server", "").lower() or "errors.edgesuite.net" in b),
    ("cloudflare", lambda h, b: "cf-ray" in h and ("cf-mitigated" in h or "just a moment" in b.lower() or "cloudflare" in b.lower()[:3000])),
    ("datadome", lambda h, b: "x-datadome" in h or "x-datadome-cid" in h or "datadome" in b.lower()[:5000]),
    ("human/perimeterx", lambda h, b: "x-px" in h or "px-captcha" in b.lower() or "_pxhc" in b.lower()),
    ("imperva", lambda h, b: "x-iinfo" in h or "incapsula" in b.lower()[:5000]),
    ("reddit", lambda h, b: "x-reddit-loid" in h or "whoa there, pardner" in b.lower()),
]


def vendor(headers: dict, body: str) -> str | None:
    for name, test in VENDOR_SIGNS:
        if test(headers, body):
            return name
    return None


def summarize(url: str, resp_status: int | None, headers: dict, body: str, error: str | None):
    text = trafilatura.extract(body) or "" if body else ""
    title = re.search(r"<title[^>]*>(.*?)</title>", body or "", re.I | re.S)
    return {
        "status": resp_status,
        "error": error,
        "vendor": vendor(headers, body or "") if body is not None else None,
        "headers": {k: headers[k][:120] for k in VENDOR_HEADERS if k in headers},
        "title": title.group(1).strip()[:150] if title else None,
        "text_chars": len(text),
        "good": len(text) >= MIN_GOOD_CHARS,
        "body_head": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body or ""))[:300],
    }


def fetch_plain(url: str):
    try:
        r = requests.get(url, headers=BROWSER_HEADERS, timeout=TIMEOUT, allow_redirects=True)
        return summarize(url, r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.text, None) | {"final_url": r.url}
    except Exception as e:
        return summarize(url, None, {}, "", f"{type(e).__name__}: {str(e)[:200]}")


def fetch_cffi(url: str):
    try:
        r = cffi.get(url, headers={k: v for k, v in BROWSER_HEADERS.items() if k != "User-Agent"},
                     impersonate="chrome", timeout=TIMEOUT, allow_redirects=True)
        return summarize(url, r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.text, None) | {"final_url": str(r.url)}
    except Exception as e:
        return summarize(url, None, {}, "", f"{type(e).__name__}: {str(e)[:200]}")


def diagnose(row: dict):
    url = row["url"]
    out = {"url": url, "logged_reason": row["reason"], "pipeline": row["pipeline"], "plain": fetch_plain(url), "curl_cffi": fetch_cffi(url)}
    print(f"{out['plain']['status']!s:>4} {out['curl_cffi']['status']!s:>4} cffi_good={out['curl_cffi']['good']!s:5} {out['plain']['vendor'] or '-':16} {url[:90]}", file=sys.stderr, flush=True)
    return out


def load_unique_failures() -> list[dict]:
    seen: dict[str, dict] = {}
    for name, pipeline in [("x_verifier_failures_14d.json", "x"), ("everything_verifier_failures_14d.json", "everything")]:
        for r in json.loads((DATA / name).read_text()):
            seen.setdefault(r["url"], {"url": r["url"], "reason": r["reason"].strip(), "pipeline": pipeline})
    return list(seen.values())


if __name__ == "__main__":
    rows = load_unique_failures()
    print(f"{len(rows)} unique failed urls", file=sys.stderr)
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(diagnose, rows))
    (DATA / "diagnosis.json").write_text(json.dumps(results, indent=1))
    print(f"wrote {len(results)} diagnoses")
