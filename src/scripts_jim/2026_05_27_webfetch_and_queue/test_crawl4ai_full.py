"""Run Crawl4AI against ALL 21 URLs that failed in iter-2.

Sanity-check: if Crawl4AI is going to be the BASE fetcher, it must recover at
least what v2 recovered (14/21 in the TS test). This script measures that.

Also tries `magic=True` and a longer wait_for to give Crawl4AI its best shot at
DataDome/JS challenges.
"""

import asyncio
import json
from pathlib import Path
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

MIN_GOOD_CHARS = 300

LOGIN_WALL_PATTERNS = [
    "log in", "log into facebook", "anmelden", "registrieren",
    "please wait for verification", "facebook this browser isn",
    "datadome", "captcha",
]

def looks_like_wall(text: str) -> bool:
    if not text:
        return True
    t = text.lower()[:1500]
    hits = sum(1 for p in LOGIN_WALL_PATTERNS if p in t)
    return hits >= 2

async def test_one(crawler, url: str, label: str, run_cfg: CrawlerRunConfig):
    try:
        result = await crawler.arun(url=url, config=run_cfg)
        md = (result.markdown or "").strip()
        return {
            "label": label,
            "url": url,
            "success": result.success,
            "status_code": result.status_code,
            "chars": len(md),
            "good": len(md) >= MIN_GOOD_CHARS and not looks_like_wall(md),
            "wall_suspected": looks_like_wall(md),
            "preview": md[:400],
            "error": result.error_message,
        }
    except Exception as e:
        return {"label": label, "url": url, "success": False, "error": str(e)[:300], "chars": 0, "good": False, "wall_suspected": False}


async def main():
    urls_path = Path(__file__).parent / "test_urls.json"
    urls = [u["url"] for u in json.loads(urls_path.read_text())]

    browser_cfg = BrowserConfig(headless=True, verbose=False)

    default_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=30_000,
        wait_for_images=False,
    )
    magic_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=45_000,
        wait_for_images=False,
        magic=True,
        simulate_user=True,
        override_navigator=True,
    )

    results = []
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        for url in urls:
            print(f"\n=== {url}", flush=True)
            r1 = await test_one(crawler, url, "default", default_cfg)
            print(f"  default → good={r1['good']} chars={r1['chars']} wall={r1.get('wall_suspected')}")
            r2 = None
            if not r1["good"]:
                r2 = await test_one(crawler, url, "magic", magic_cfg)
                print(f"  magic   → good={r2['good']} chars={r2['chars']} wall={r2.get('wall_suspected')}")
            results.append({"url": url, "default": r1, "magic": r2})

    out_path = Path(__file__).parent / "crawl4ai_full_results.json"
    out_path.write_text(json.dumps(results, indent=2))

    total = len(results)
    default_good = sum(1 for r in results if r["default"]["good"])
    any_good = sum(1 for r in results if r["default"]["good"] or (r["magic"] and r["magic"]["good"]))
    print(f"\n=== SUMMARY ({total} URLs) ===")
    print(f"  crawl4ai default: {default_good}/{total} good")
    print(f"  crawl4ai default+magic: {any_good}/{total} good")
    print(f"  TS v2 reference:    14/{total} good (67%)")

if __name__ == "__main__":
    asyncio.run(main())
