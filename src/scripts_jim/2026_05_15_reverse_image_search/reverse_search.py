"""Reverse image search via Yandex Images (Playwright).

Why Yandex and not Google: headless Chromium hitting `lens.google.com` gets
served the `/sorry` CAPTCHA wall almost immediately. Yandex is significantly
more lenient toward automation and — per OSINT practitioner consensus —
typically returns equally good or better visual-match results, especially for
faces and near-duplicates.

The returned structure is intentionally minimal: enough for an LVLM to use the
context, nothing more. Yandex also surfaces an "object response" header (its
own AI summary of what the image shows) which we capture separately as
`object_summary`.

Usage:
    .venv/bin/python src/scripts_jim/2026_05_15_reverse_image_search/reverse_search.py \\
        https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg
"""

from __future__ import annotations

import asyncio
import json
import sys
import urllib.parse
from dataclasses import dataclass, asdict, field
from typing import Any

from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeout


YANDEX_BY_URL = "https://yandex.com/images/search?rpt=imageview&url={}"


@dataclass
class LensMatch:
    thumb_url: str | None
    page_url: str
    page_title: str
    snippet: str | None
    source_domain: str | None


@dataclass
class ReverseSearchResult:
    query_image_url: str
    object_summary: str | None  # Yandex's AI guess at what the image shows.
    matches: list[LensMatch] = field(default_factory=list)


async def extract(page: Page, top_n: int) -> ReverseSearchResult:
    data = await page.evaluate(
        """(topN) => {
            const items = Array.from(document.querySelectorAll('li.CbirSites-Item'));
            const matches = [];
            for (const li of items.slice(0, topN)) {
                const thumbA = li.querySelector('.CbirSites-ItemThumb a');
                const titleA = li.querySelector('.CbirSites-ItemTitle a');
                const domainA = li.querySelector('.CbirSites-ItemDomain');
                const descD = li.querySelector('.CbirSites-ItemDescription');
                const thumbImg = li.querySelector('.CbirSites-ItemThumb img');
                matches.push({
                    thumb_url: thumbImg ? (thumbImg.src || null) : null,
                    page_url: (titleA && titleA.href) || (thumbA && thumbA.href) || '',
                    page_title: titleA ? (titleA.textContent || '').trim() : '',
                    snippet: descD ? (descD.textContent || '').trim() || null : null,
                    source_domain: domainA ? (domainA.textContent || '').trim() : null,
                });
            }
            // Yandex's object response (top of page) — its own AI summary
            const objTitle = document.querySelector('.CbirObjectResponse-Title');
            const objDesc = document.querySelector('.CbirObjectResponse-Description');
            const parts = [];
            if (objTitle) parts.push(objTitle.textContent.trim());
            if (objDesc) parts.push(objDesc.textContent.trim());
            return { matches, object_summary: parts.join(' — ') || null };
        }""",
        top_n,
    )
    return ReverseSearchResult(
        query_image_url="",
        object_summary=data["object_summary"],
        matches=[LensMatch(**m) for m in data["matches"]],
    )


async def reverse_search(
    image_url: str, top_n: int = 5, headless: bool = True
) -> ReverseSearchResult:
    target = YANDEX_BY_URL.format(urllib.parse.quote(image_url, safe=""))
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            viewport={"width": 1366, "height": 900},
        )
        page = await ctx.new_page()
        try:
            await page.goto(target, wait_until="domcontentloaded", timeout=45000)
            try:
                await page.wait_for_selector(
                    "li.CbirSites-Item, .CbirObjectResponse-Title", timeout=20000
                )
            except PWTimeout:
                pass
            await page.wait_for_timeout(1000)
            result = await extract(page, top_n)
            result.query_image_url = image_url
            return result
        finally:
            await ctx.close()
            await browser.close()


async def main_async() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    image_url = sys.argv[1]
    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    headless = "--headed" not in sys.argv

    result = await reverse_search(image_url, top_n=top_n, headless=headless)
    out = {
        "query_image_url": result.query_image_url,
        "object_summary": result.object_summary,
        "matches": [asdict(m) for m in result.matches],
    }
    print(json.dumps(out, indent=2))
    print(f"\n[{len(result.matches)} matches]  object_summary: {result.object_summary!r}")


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
