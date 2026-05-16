"""Debug helper: navigate to Lens and dump page state."""
import asyncio
import sys
import urllib.parse
from playwright.async_api import async_playwright


async def main() -> None:
    image_url = sys.argv[1] if len(sys.argv) > 1 else "https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg"
    target = f"https://lens.google.com/uploadbyurl?url={urllib.parse.quote(image_url, safe='')}"
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            locale="en-US",
        )
        page = await ctx.new_page()
        await page.goto(target, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(5000)
        print(f"URL after nav: {page.url}")
        title = await page.title()
        print(f"Title: {title}")
        html = await page.content()
        print(f"HTML length: {len(html)}")
        out_html = "/tmp/lens_debug.html"
        out_png = "/tmp/lens_debug.png"
        with open(out_html, "w") as f:
            f.write(html)
        await page.screenshot(path=out_png, full_page=True)
        # Sample anchors
        anchors = await page.evaluate(
            "Array.from(document.querySelectorAll('a[href]')).slice(0,40).map(a=>({href:a.href,text:(a.innerText||'').slice(0,80)}))"
        )
        for a in anchors[:20]:
            print(f"  {a['href'][:100]}  | {a['text']}")
        print(f"Saved HTML → {out_html}, screenshot → {out_png}")
        await ctx.close()
        await browser.close()


asyncio.run(main())
