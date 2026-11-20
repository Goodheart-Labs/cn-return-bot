/** Checks readWatchPageChannel on an ordinary video, then moves to the
 *  collaboration video the way a reader does, through YouTube's search, so
 *  YouTube switches videos in place without reloading the page. The reader
 *  must name the uploader of each, never the previous video's channel. */
import { launchWithExtension, openPage } from "../../everything-extension/scripts/browser";
import { readWatchPageChannel } from "../../everything-extension/utils/creatorTarget";

const SETTLE_MS = 8000;
const ORDINARY = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const COLLAB_ID = "zB6PhTxnj7U";
const context = await launchWithExtension();
await context.route(/ytimg\.com|ggpht\.com/, (route) => route.abort());
const page = await openPage(context, ORDINARY, () => {});
await page.waitForTimeout(SETTLE_MS);
console.log("ordinary video:", await page.evaluate(readWatchPageChannel));
await page.locator("input[name=search_query]").fill("Chris Williamson Fat Electrician");
await page.keyboard.press("Enter");
await page.waitForURL(/results/);
await page.locator(`a[href*="${COLLAB_ID}"]`).locator("visible=true").first().click();
await page.waitForURL(new RegExp(COLLAB_ID));
for (const afterMs of [500, 1500, 3000, 6000]) {
  await page.waitForTimeout(afterMs);
  console.log(`collab video, in place, ${afterMs} ms later:`, await page.evaluate(readWatchPageChannel));
}
console.log("navigation was in place:", await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.name));
await context.close();
