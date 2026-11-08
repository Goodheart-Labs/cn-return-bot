import { chromium, type Browser } from "playwright";

/* A picture of a note's card for its tweet, taken with a headless Chromium
 * from the website's picture page, /note-image/<note>. The local posting tool
 * (server.ts) takes it from its own development site, and the posting worker
 * (worker.ts) from commonnotes.net. */

/** The picture is taken at twice the CSS size, for sharp text. */
const IMAGE_SCALE = 2;
const IMAGE_TIMEOUT_MS = 20_000;
export const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let browser: Browser | null = null;

/** Opens the note's picture page on `site` and saves a picture of its card to
 *  `path`. */
export async function takeNoteImage(site: string, noteId: string, path: string): Promise<void> {
  if (!NOTE_ID.test(noteId)) throw new Error(`${noteId} is not a note's id`);
  if (!browser?.isConnected()) browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: IMAGE_SCALE });
  try {
    await page.goto(`${site}/note-image/${noteId}`);
    const card = page.locator("[data-note-image]");
    await card.waitFor({ timeout: IMAGE_TIMEOUT_MS });
    await page.waitForLoadState("networkidle");
    await card.screenshot({ path });
  } finally {
    await page.close();
  }
}

export const closeBrowser = () => browser?.close();
