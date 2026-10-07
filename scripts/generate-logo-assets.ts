/** Draws every PNG of the logo from src/everything-ui/assets/logo.svg: the
 *  extension's icons, the icon Firefox's add-on listing asks for, and the
 *  website's PNG favicon, home screen icon and link preview card. The Safari app's icons have
 *  their own script, src/everything-extension/scripts/safariAppIcons.ts.
 *  It renders through Chrome with Playwright, because Playwright is already a
 *  dependency of this repo. macOS has no reliable command line SVG rasterizer.
 *  sips mangles SVGs, and rsvg-convert is not installed.
 *  The PNGs are checked in, so run this again only when the logo changes:
 *
 *    bun run scripts/generate-logo-assets.ts
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dir, "..");
const LOGO = readFileSync(path.join(ROOT, "src/everything-ui/assets/logo.svg"), "utf8");

interface Raster {
  file: string;
  size: number;
  /** How wide the logo is drawn inside the square. The rest stays transparent. */
  artwork: number;
}

// The Chrome Web Store asks for a transparent margin around the 128 pixel
// icon's artwork, and the manifest's 128 pixel icon is that same file. Its
// guide wants a square icon 96 pixels wide, a circle 112, and an irregular
// shape somewhere near both. The logo is wider than it is tall and covers
// little of its square, so it gets the circle's 112. Every other size fills
// its whole square. Mozilla's add-on listing wants a full 128 pixel icon. It
// is written to assets/ rather than public/, so it never ships inside the
// extension zip.
const CHROME_STORE_ARTWORK = 112;
// Google Search shows a site's favicon next to its results only if the icon
// is square and its width is a multiple of 48 pixels. Browsers scale the same
// file down for their tabs.
const FAVICON_SIZE = 96;
const RASTERS: Raster[] = [
  { file: "src/everything-extension/public/icon/16.png", size: 16, artwork: 16 },
  { file: "src/everything-extension/public/icon/32.png", size: 32, artwork: 32 },
  { file: "src/everything-extension/public/icon/48.png", size: 48, artwork: 48 },
  { file: "src/everything-extension/public/icon/128.png", size: 128, artwork: CHROME_STORE_ARTWORK },
  { file: "src/everything-extension/assets/store-icon-128-full.png", size: 128, artwork: 128 },
  { file: "src/everything-web/src/assets/favicon-96.png", size: FAVICON_SIZE, artwork: FAVICON_SIZE },
  { file: "src/everything-web/src/assets/apple-touch-icon.png", size: 180, artwork: 180 },
];

// Chrome itself on a Mac, Playwright's own Chromium elsewhere.
// Machines without Chromium's system libraries keep them in this folder.
const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch(
  process.platform === "darwin"
    ? { channel: "chrome" }
    : { env: { ...process.env, LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } },
);
const page = await browser.newPage();

for (const { file, size, artwork } of RASTERS) {
  const inset = (size - artwork) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${artwork}px;height:${artwork}px;margin:${inset}px}</style>${LOGO}`,
  );
  const outPath = path.join(ROOT, file);
  await page.screenshot({ path: outPath, omitBackground: true });
  console.log(`wrote ${outPath}`);
}
// The card that link previews and search results show for the website. It is
// drawn at twice its size, so it stays sharp on high density screens.
// Apps cache a preview image by its address, so a changed card needs a new file
// name. Raise the number here and in og:image and twitter:image in
// src/everything-web/index.html and in the static pages
// src/everything-web/public/privacy/index.html and public/terms/index.html.
const OG_CARD = { width: 1200, height: 630, scale: 2, file: "og-2.png" };
const cardPage = await browser.newPage({
  viewport: { width: OG_CARD.width, height: OG_CARD.height },
  deviceScaleFactor: OG_CARD.scale,
});
await cardPage.goto(pathToFileURL(path.join(ROOT, "src/everything-web/og-card.html")).href);
await cardPage.evaluate(() => document.fonts.ready);
const ogPath = path.join(ROOT, "src/everything-web/public", OG_CARD.file);
await cardPage.screenshot({ path: ogPath });
console.log(`wrote ${ogPath}`);

await browser.close();
