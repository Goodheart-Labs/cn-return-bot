/* Opens the public Common Notes site on the share link of one note and
 * screenshots it, so we can see how a note whose text is empty in the database
 * renders. Headless only, it never touches a real browser profile. */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const NOTE_ID = "929b0389-aca3-47a6-bdfe-2a7c1833b209";
const PROJECT_SLUG = "joerogan";
const SITE_URL = "https://goodheart-labs.github.io/cn-return-bot/notes/";
const NOTE_URL = `${SITE_URL}?project=${PROJECT_SLUG}&note=${NOTE_ID}`;
const CARD_WAIT_MS = 20000;
const SETTLE_MS = 3000;

const outDir = path.resolve(import.meta.dir, "data");
const screenshotPath = path.join(outDir, "website_note.png");

const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const env = {
  ...process.env,
  ...(fs.existsSync(localLibs)
    ? { LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
    : {}),
};

/* The Playwright package is newer than the Chromium build this box has
 * downloaded, so we point at the build that is actually on disk instead of
 * asking for a channel that would have to be downloaded first. */
const installedChromium = path.join(os.homedir(), ".cache/ms-playwright/chromium-1193/chrome-linux/chrome");
const browser = await chromium.launch({
  headless: true,
  env,
  ...(fs.existsSync(installedChromium) ? { executablePath: installedChromium } : {}),
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("console", (message) => console.log(`console(${message.type()}): ${message.text()}`));
page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));

console.log(`opening ${NOTE_URL}`);
const response = await page.goto(NOTE_URL, { waitUntil: "domcontentloaded" });
console.log(`http status: ${response?.status()}`);

const card = page.locator(`#note-${NOTE_ID}`);
let cardFound = true;
try {
  await card.waitFor({ state: "attached", timeout: CARD_WAIT_MS });
} catch {
  cardFound = false;
  console.log("the note card never appeared");
}
await page.waitForTimeout(SETTLE_MS);

fs.mkdirSync(outDir, { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log(`screenshot: ${screenshotPath}`);

if (cardFound) {
  console.log("--- card innerText ---");
  console.log(await card.innerText());
  console.log("--- card innerHTML ---");
  console.log(await card.innerHTML());
  await card.screenshot({ path: path.join(outDir, "website_note_card.png") }).catch(() => {});
} else {
  console.log("--- body innerText ---");
  console.log(await page.locator("body").innerText());
}

await browser.close();
