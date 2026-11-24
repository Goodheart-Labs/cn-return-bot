/** Reproduces the site check "A watch page's channel is read out of the page"
 *  and prints what the owner box holds at several moments after the load. */
import { launchWithExtension, openPage } from "../../everything-extension/scripts/browser";
import { readWatchPageChannel } from "../../everything-extension/utils/creatorTarget";
import { residentialProxyForBrowser } from "../../pipeline/utils/residentialProxy";

const POLL_MS = 2000;
const POLLS = 10;
const url = process.argv[2] ?? "https://www.youtube.com/watch?v=zB6PhTxnj7U";
const context = await launchWithExtension(process.argv.includes("--proxy") ? residentialProxyForBrowser() : undefined);
await context.route(/ytimg\.com|ggpht\.com/, (route) => route.abort());
const page = await openPage(context, url, () => {});
for (let poll = 1; poll <= POLLS; poll++) {
  await page.waitForTimeout(POLL_MS);
  const channel = await page.evaluate(readWatchPageChannel);
  const owner = await page.evaluate(() => {
    const box = document.querySelector("ytd-video-owner-renderer");
    if (!box) return "no ytd-video-owner-renderer";
    const links = [...box.querySelectorAll("a[href]")].map((a) => `${a.tagName}.${a.className} ${(a as HTMLAnchorElement).href} "${a.textContent?.trim().slice(0, 30)}"`);
    return `channel-name present=${!!box.querySelector("ytd-channel-name")}; links=${JSON.stringify(links)}`;
  });
  console.log(`${poll * POLL_MS / 1000}s: reader=${channel ? channel.href : "null"} | ${owner}`);
  if (channel && poll >= 4) break;
}
console.log("owner html:", await page.evaluate(() => document.querySelector("ytd-video-owner-renderer")?.outerHTML.replace(/\s+/g, " ").replace(/<!--.*?-->/g, "").slice(0, 2500)));
await context.close();
