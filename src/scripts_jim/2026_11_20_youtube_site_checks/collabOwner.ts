/** Dumps what a collaboration video's watch page says about its channels:
 *  the owner box's text parts, the microformat links and every channel link
 *  under the video's metadata. */
import { launchWithExtension, openPage } from "../../everything-extension/scripts/browser";

const SETTLE_MS = 8000;
const url = process.argv[2] ?? "https://www.youtube.com/watch?v=zB6PhTxnj7U";
const context = await launchWithExtension();
await context.route(/ytimg\.com|ggpht\.com/, (route) => route.abort());
const page = await openPage(context, url, () => {});
await page.waitForTimeout(SETTLE_MS);
console.log(JSON.stringify(await page.evaluate(() => {
  const box = document.querySelector("ytd-video-owner-renderer");
  const strip = (html: string | undefined) => html?.replace(/<!--.*?-->/g, "").replace(/\s+/g, " ");
  return {
    uploadInfo: strip(box?.querySelector("#upload-info")?.outerHTML)?.slice(0, 3000),
    ownerAnchor: strip(box?.querySelector(":scope > a")?.outerHTML)?.slice(0, 300),
    microformat: [...document.querySelectorAll('[itemprop="author"] link, link[itemprop], meta[itemprop="channelId"]')].map((el) => el.outerHTML),
    channelLinksInMetadata: [...document.querySelectorAll("ytd-watch-metadata a[href]")].map((a) => (a as HTMLAnchorElement).href).filter((h) => /\/(@|channel\/|c\/|user\/)/.test(h)),
    subscribe: strip(document.querySelector("ytd-watch-metadata #subscribe-button")?.outerHTML)?.slice(0, 400),
  };
}), null, 2));
await context.close();
