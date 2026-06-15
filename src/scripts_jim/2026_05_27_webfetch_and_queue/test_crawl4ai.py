"""Test Crawl4AI against URLs that the TS v2 strategy still failed on.

These are the hard cases: Instagram SPAs, Facebook walls, Reddit interstitials,
trueachievements.com 403 wall, BLS PDF.
"""

import asyncio
import json
from pathlib import Path
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

V2_FAILED_URLS = [
    # Iter-2 + my v2 both empty
    "https://www.reddit.com/r/GetNoted/comments/1rt9xyh/de_niro_and_mamdani/",
    "https://www.instagram.com/p/DUWHli8gTpK/",
    "https://www.facebook.com/NBCBayArea/videos/police-investigating-santana-row-attack-as-possible-hate-crime/2384729795331069/",
    "https://www.instagram.com/reel/DToWOookcl4/?hl=de",
    "https://www.trueachievements.com/news/asha-sharma-xbox-gamertag",
    "https://www.bls.gov/news.release/pdf/cpi.pdf",
    # Plus one FB that v2 PARTIALLY recovered to compare quality
    "https://www.facebook.com/photo.php?fbid=982113224486408&set=a.850196581011407&id=100080632194001",
    # And one Reuters as a sanity check (v2 nailed this)
    "https://www.reuters.com/fact-check/netanyahus-press-conference-dispels-death-rumours-2026-03-24/",
]

MIN_GOOD_CHARS = 300

async def test_one(crawler, url):
    try:
        result = await crawler.arun(
            url=url,
            config=CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=30_000,
                wait_for_images=False,
            ),
        )
        md = (result.markdown or "").strip()
        return {
            "url": url,
            "success": result.success,
            "status_code": result.status_code,
            "markdown_chars": len(md),
            "good": len(md) >= MIN_GOOD_CHARS,
            "preview": md[:400],
            "error": result.error_message,
        }
    except Exception as e:
        return {"url": url, "success": False, "error": str(e)[:300], "markdown_chars": 0, "good": False}


async def main():
    browser_cfg = BrowserConfig(
        headless=True,
        verbose=False,
    )
    results = []
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        for url in V2_FAILED_URLS:
            print(f"\n=== {url}", flush=True)
            r = await test_one(crawler, url)
            print(f"  success={r.get('success')} status={r.get('status_code')} chars={r.get('markdown_chars')} good={r.get('good')}")
            if r.get("error"):
                print(f"  error: {r['error'][:200]}")
            if r.get("preview"):
                print(f"  preview: {r['preview'][:300]}")
            results.append(r)

    out_path = Path(__file__).parent / "crawl4ai_results.json"
    out_path.write_text(json.dumps(results, indent=2))

    good = sum(1 for r in results if r["good"])
    print(f"\n=== SUMMARY: {good}/{len(results)} good")


if __name__ == "__main__":
    asyncio.run(main())
