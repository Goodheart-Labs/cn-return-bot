/** Draws the two promo images of the Chrome Web Store listing from the logo
 *  and the first store screenshot: the small tile (440x280), which Chrome shows
 *  in search results and category pages, and the marquee (1400x560), which it
 *  shows when it features the extension. They are checked in, so run this
 *  again only when the logo, the tagline or that screenshot changes:
 *
 *    bun run src/everything-extension/scripts/storePromoTiles.ts
 *
 *  It renders HTML in headless Chromium, like scripts/generate-logo-assets.ts.
 *  The website's title font, SF Pro Display, exists only on Apple devices, so
 *  the tiles use Inter, which looks close to it. */
import { readFileSync } from "node:fs";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const EXTENSION_DIR = path.resolve(import.meta.dir, "..");
const STORE_ASSETS_DIR = path.join(EXTENSION_DIR, "store-assets");
const LOGO = readFileSync(path.join(EXTENSION_DIR, "../everything-ui/assets/logo.svg"), "utf8");
const MARQUEE_SCREENSHOT = readFileSync(path.join(STORE_ASSETS_DIR, "screenshots/1-substack-note.png")).toString("base64");

const TAGLINE = "Community Notes Everywhere";
const PITCH = "Notes pointing out false statements or adding useful context to whatever you are reading or watching.";

const PAGE_STYLE = `
  @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=block");
  * { margin: 0; box-sizing: border-box; }
  body { font-family: Inter, sans-serif; color: #111827; }
  .logo svg { display: block; width: 100%; height: auto; }
  h1 { font-weight: 700; letter-spacing: -0.02em; }
  .tagline { color: #4b5563; font-weight: 500; }
`;

const SMALL_TILE = `
  <div style="width:440px;height:280px;background:#ffffff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
    <div class="logo" style="width:104px">${LOGO}</div>
    <h1 style="font-size:38px">Common Notes</h1>
    <p class="tagline" style="font-size:18px">${TAGLINE}</p>
  </div>`;

const MARQUEE = `
  <div style="width:1400px;height:560px;background:#f3f4f6;display:flex;align-items:center;gap:64px;padding:0 0 0 88px;overflow:hidden">
    <div style="width:440px;flex:none">
      <div style="display:flex;align-items:center;gap:20px">
        <div class="logo" style="width:96px">${LOGO}</div>
        <h1 style="font-size:52px;line-height:1.05">Common Notes</h1>
      </div>
      <p class="tagline" style="font-size:26px;margin-top:28px;color:#111827">${TAGLINE}</p>
      <p style="font-size:20px;line-height:1.5;margin-top:14px;color:#4b5563">${PITCH}</p>
    </div>
    <img src="data:image/png;base64,${MARQUEE_SCREENSHOT}"
      style="width:760px;border-radius:14px;box-shadow:0 18px 50px rgb(17 24 39 / 0.18);border:1px solid #e5e7eb">
  </div>`;

const TILES = [
  { file: "promo-small-440x280.png", html: SMALL_TILE, width: 440, height: 280 },
  { file: "promo-marquee-1400x560.png", html: MARQUEE, width: 1400, height: 560 },
];

// The devbox lacks some of Chromium's system libraries. scripts/browser.ts
// explains where these extracted copies come from.
const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({
  env: fs.existsSync(localLibs) ? { ...process.env, LD_LIBRARY_PATH: localLibs } : process.env,
});
for (const tile of TILES) {
  const page = await browser.newPage({ viewport: { width: tile.width, height: tile.height } });
  await page.setContent(`<style>${PAGE_STYLE}</style>${tile.html}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(STORE_ASSETS_DIR, tile.file) });
  console.log(`wrote ${tile.file}`);
}
await browser.close();
