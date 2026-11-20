/** Prints, for every channel link under a watch page's metadata, the chain of
 *  elements it sits in and its text, to find a stable place that names the
 *  uploading channel. */
import { launchWithExtension, openPage } from "../../everything-extension/scripts/browser";

const SETTLE_MS = 8000;
const url = process.argv[2] ?? "https://www.youtube.com/watch?v=zB6PhTxnj7U";
const context = await launchWithExtension();
await context.route(/ytimg\.com|ggpht\.com/, (route) => route.abort());
const page = await openPage(context, url, () => {});
await page.waitForTimeout(SETTLE_MS);
console.log(JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll<HTMLAnchorElement>("ytd-watch-metadata a[href]")]
    .filter((a) => /\/(@|channel\/)/.test(a.href))
    .map((a) => {
      const chain: string[] = [];
      for (let el: Element | null = a; el && el.tagName !== "YTD-WATCH-METADATA"; el = el.parentElement) chain.push(el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""));
      return { href: a.href, id: a.id, text: a.textContent?.trim().replace(/\s+/g, " ").slice(0, 60), chain: chain.join(" < ") };
    })), null, 2));
await context.close();
