"""Debug: probe Yandex Images reverse search via Playwright."""
import asyncio
import sys
import urllib.parse
from playwright.async_api import async_playwright


YANDEX_URL = "https://yandex.com/images/search?rpt=imageview&url={}"


async def main() -> None:
    image_url = sys.argv[1] if len(sys.argv) > 1 else "https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg"
    target = YANDEX_URL.format(urllib.parse.quote(image_url, safe=""))
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            locale="en-US",
            viewport={"width": 1366, "height": 900},
        )
        page = await ctx.new_page()
        await page.goto(target, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(5000)
        print(f"URL after nav: {page.url}")
        print(f"Title: {await page.title()}")
        html = await page.content()
        print(f"HTML length: {len(html)}")
        with open("/tmp/yandex_debug.html", "w") as f:
            f.write(html)
        await page.screenshot(path="/tmp/yandex_debug.png", full_page=True)
        # Sample anchors with external hrefs
        anchors = await page.evaluate(
            """() => Array.from(document.querySelectorAll('a[href]'))
                .filter(a => { try { const u=new URL(a.href); return !u.hostname.includes('yandex'); } catch { return false; } })
                .slice(0, 30)
                .map(a => ({ href: a.href, text: (a.innerText||'').slice(0,80) }))"""
        )
        print(f"External anchors: {len(anchors)}")
        for a in anchors[:15]:
            print(f"  {a['href'][:90]}  | {a['text']}")
        await ctx.close()
        await browser.close()


asyncio.run(main())
