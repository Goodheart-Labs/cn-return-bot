// Opens a page in Chromium with the freshly built extension loaded and writes
// a screenshot. This is how a session on the headless devbox looks at its own
// extension work: build, run this, read the image.
//
//   bun run src/everything-extension/scripts/preview.ts <url> <out.png> [--full]
//
// It loads the prod-backend build from .output, so run `bun run build-ext-dev`
// (or build-ext) first. The profile directory is kept between runs, which
// keeps the background's synced coverage cache warm; on a cold profile the
// script reloads the page until the sync has landed and badges can render.
// On a machine without Chromium's system libraries, extract the needed .debs
// into ~/.cache/cn-playwright-libs (no root needed) and this script puts them
// on the library path by itself.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BADGE_WAIT_ROUNDS = 6;
const BADGE_WAIT_PER_ROUND_MS = 4000;

const [url, out, flag] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: preview.ts <url> <out.png> [--full]");
  process.exit(1);
}

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

// YouTube greets a fresh European profile with a consent page. Declining it
// once is enough, because the choice sticks in the kept profile.
const consent = page.getByRole("button", { name: /alle ablehnen|reject all/i }).first();
if (await consent.isVisible({ timeout: 3000 }).catch(() => false)) {
  await consent.click();
  await page.waitForLoadState("domcontentloaded");
}

// On a cold profile the badges cannot render before the background has synced
// the note counts, so we give the page a few reload rounds to get there.
for (let round = 0; round < BADGE_WAIT_ROUNDS; round++) {
  await page.waitForTimeout(BADGE_WAIT_PER_ROUND_MS);
  const badges = await page.locator(".cn-coverage-badge").count();
  if (badges > 0 || round === BADGE_WAIT_ROUNDS - 1) {
    console.log(`${badges} coverage badge(s) on the page`);
    break;
  }
  await page.reload({ waitUntil: "domcontentloaded" });
}

await page.screenshot({ path: out, fullPage: flag === "--full" });
console.log(`screenshot: ${out}`);
await context.close();
