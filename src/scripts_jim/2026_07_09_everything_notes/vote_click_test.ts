// Click the Helpful button in a real browser and verify the live count updates
// (FE → cast_everything_vote RPC → trigger → realtime → FE).
import { chromium } from "playwright";

const OUT = process.env.SCREENSHOT_OUT ?? "/tmp/everything-web-vote.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
await page.goto("http://localhost:8003/", { waitUntil: "networkidle" });
await page.waitForSelector("text=Community Note");
await page.click("button:has-text('Not helpful')");
// Wait for the realtime UPDATE to push the new count back into the button.
await page.waitForSelector("button:has-text('👎 Not helpful 2')", { timeout: 10_000 });
await page.screenshot({ path: OUT, fullPage: false });
console.log(`vote registered live; saved ${OUT}`);
await browser.close();
