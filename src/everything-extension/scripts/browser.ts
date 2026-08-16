// The shared launch used by the devbox inspection scripts (preview.ts,
// inspect.ts): headless Chromium with the freshly built extension loaded.
// See preview.ts for the background on the library path and the kept profile.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

/** Launches the browser, opens `url`, and declines YouTube's consent page if
 *  it shows up (a fresh European profile gets one; the choice sticks in the
 *  kept profile). The caller closes the returned context when done. */
export async function openPageWithExtension(url: string): Promise<{ context: BrowserContext; page: Page }> {
  const extensionDir = path.resolve(import.meta.dir, "../.output/chrome-mv3-prod-backend");
  if (!fs.existsSync(path.join(extensionDir, "manifest.json"))) {
    throw new Error(`no build at ${extensionDir} — run bun run build-ext-dev first`);
  }

  const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
  const env = {
    ...process.env,
    ...(fs.existsSync(localLibs)
      ? { LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
      : {}),
  };

  const context = await chromium.launchPersistentContext(path.join(os.homedir(), ".cache/cn-preview-profile"), {
    // Extensions need the real Chromium in its new headless mode. The default
    // headless shell silently ignores --load-extension.
    channel: "chromium",
    headless: true,
    env,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[common-notes]")) console.log(`console: ${text}`);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const consent = page.getByRole("button", { name: /alle ablehnen|reject all/i }).first();
  if (await consent.isVisible({ timeout: 3000 }).catch(() => false)) {
    await consent.click();
    await page.waitForLoadState("domcontentloaded");
  }

  return { context, page };
}
