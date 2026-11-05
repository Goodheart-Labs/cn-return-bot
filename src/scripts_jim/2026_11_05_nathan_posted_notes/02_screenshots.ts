/* Step 2: a picture of each note's card, the way the local posting tool takes
 * it (src/note-tweets/server.ts). Needs the website running with the note
 * picture page switched on:
 *   cd src/everything-web && VITE_TWEET_SERVER=http://127.0.0.1:9 bunx vite --port 5199 --host 127.0.0.1 --strictPort --mode prod-backend
 * Then: bun run src/scripts_jim/2026_11_05_nathan_posted_notes/02_screenshots.ts <note id> ...
 * The pictures go to images/ next to this file. */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const SITE = "http://127.0.0.1:5199";
const IMAGE_DIR = new URL("./images/", import.meta.url).pathname;
/** The posting tool takes its pictures at twice the CSS size, for sharp text. */
const IMAGE_SCALE = 2;
const IMAGE_TIMEOUT_MS = 30_000;

await mkdir(IMAGE_DIR, { recursive: true });
const browser = await chromium.launch();
for (const noteId of process.argv.slice(2)) {
  const page = await browser.newPage({ deviceScaleFactor: IMAGE_SCALE });
  try {
    await page.goto(`${SITE}/note-image/${noteId}`);
    const card = page.locator("[data-note-image]");
    await card.waitFor({ timeout: IMAGE_TIMEOUT_MS });
    await page.waitForLoadState("networkidle");
    await card.screenshot({ path: `${IMAGE_DIR}${noteId}.png` });
    console.log(`ok ${noteId}`);
  } catch (error) {
    console.log(`failed ${noteId}: ${(error as Error).message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
