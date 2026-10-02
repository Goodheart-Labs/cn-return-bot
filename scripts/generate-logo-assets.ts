/** Draws every PNG of the logo from src/everything-ui/assets/logo.svg: the
 *  extension's icons, the icon Firefox's add-on listing asks for, and the
 *  website's PNG favicon and home screen icon. The Safari app's icons have
 *  their own script, src/everything-extension/scripts/safariAppIcons.ts.
 *  It renders through Chrome with Playwright, because Playwright is already a
 *  dependency of this repo. macOS has no reliable command line SVG rasterizer.
 *  sips mangles SVGs, and rsvg-convert is not installed.
 *  The PNGs are checked in, so run this again only when the logo changes:
 *
 *    bun run scripts/generate-logo-assets.ts
 */
import { readFileSync } from "node:fs";
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

// The Chrome Web Store asks for the 128 pixel icon to carry its artwork at 96
// by 96 inside a transparent margin, and the manifest's 128 pixel icon is that
// same file. Every other size fills its whole square. Mozilla's add-on listing
// wants a full 128 pixel icon. It is written to assets/ rather than public/,
// so it never ships inside the extension zip.
const RASTERS: Raster[] = [
  { file: "src/everything-extension/public/icon/16.png", size: 16, artwork: 16 },
  { file: "src/everything-extension/public/icon/32.png", size: 32, artwork: 32 },
  { file: "src/everything-extension/public/icon/48.png", size: 48, artwork: 48 },
  { file: "src/everything-extension/public/icon/128.png", size: 128, artwork: 96 },
  { file: "src/everything-extension/assets/store-icon-128-full.png", size: 128, artwork: 128 },
  { file: "src/everything-web/src/assets/favicon-32.png", size: 32, artwork: 32 },
  { file: "src/everything-web/src/assets/apple-touch-icon.png", size: 180, artwork: 180 },
];

// Chrome itself on a Mac, Playwright's own Chromium elsewhere.
const browser = await chromium.launch(process.platform === "darwin" ? { channel: "chrome" } : {});
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
await browser.close();
