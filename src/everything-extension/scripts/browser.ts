// The shared launch used by the devbox inspection scripts (preview.ts,
// inspect.ts) and the daily site checks (src/site-checks/): headless Chromium
// with the freshly built extension loaded. See preview.ts for the background
// on the kept profile.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const BADGE_WAIT_ROUNDS = 6;
const BADGE_WAIT_PER_ROUND_MS = 4000;

/** Launches headless Chromium with the built extension. The caller closes
 *  the returned context when done. */
export async function launchWithExtension(): Promise<BrowserContext> {
  const extensionDir = path.resolve(import.meta.dir, "../.output/chrome-mv3-prod-backend");
  if (!fs.existsSync(path.join(extensionDir, "manifest.json"))) {
    throw new Error(`no build at ${extensionDir}. Run bun run build-ext-dev first.`);
  }

  // Chromium caches the background service worker's script in the profile and
  // keeps running that copy when a new build has the same manifest version. A
  // preview then ran last month's background, whose sync wrote storage keys
  // the current content scripts no longer read, so no badge ever showed
  // (GOO-365). Removing the cache makes every launch start the current build.
  const profileDir = path.join(os.homedir(), ".cache/cn-preview-profile");
  fs.rmSync(path.join(profileDir, "Default/Service Worker"), { recursive: true, force: true });

  return chromium.launchPersistentContext(profileDir, {
    // Extensions need the real Chromium in its new headless mode. The default
    // headless shell silently ignores --load-extension.
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
}

/** Opens `url` in a new tab and declines YouTube's consent page if it shows
 *  up. A fresh European profile gets one, and the choice sticks in the kept
 *  profile. Every console line of the extension goes to `onLog`. */
export async function openPage(context: BrowserContext, url: string, onLog: (line: string) => void): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[common-notes]")) onLog(text);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const consent = page.getByRole("button", { name: /alle ablehnen|reject all/i }).first();
  if (await consent.isVisible({ timeout: 3000 }).catch(() => false)) {
    await consent.click();
    await page.waitForLoadState("domcontentloaded");
  }
  return page;
}

/** Launches the browser and opens `url`, logging the extension's console. */
export async function openPageWithExtension(url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await launchWithExtension();
  const page = await openPage(context, url, (line) => console.log(`console: ${line}`));
  return { context, page };
}

/** Waits until the page shows listing badges and returns how many. On a cold
 *  profile the badges cannot render before the background has synced the note
 *  counts, so the page gets a few reload rounds to get there. */
export async function waitForBadges(page: Page): Promise<number> {
  for (let round = 0; round < BADGE_WAIT_ROUNDS; round++) {
    await page.waitForTimeout(BADGE_WAIT_PER_ROUND_MS);
    const badges = await page.locator(".cn-coverage-badge").count();
    if (badges > 0 || round === BADGE_WAIT_ROUNDS - 1) return badges;
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  return 0;
}
