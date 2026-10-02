/** Turn the logo into the PNG sizes the extension's manifest needs.
 *  The 48 and 128 pixel icons, for the extensions page and the stores, are the
 *  website's logo, src/everything-ui/assets/logo.svg. The toolbar and the
 *  right-click menu show the 16 and 32 pixel icons. At those sizes the logo's
 *  thin lines and borders blur, so they are drawn from a bolder version,
 *  src/everything-extension/assets/icon-small.svg.
 *  It renders through Chrome with Playwright, because Playwright is already a
 *  dependency of this repo. macOS has no reliable command line SVG rasterizer.
 *  sips mangles SVGs, and rsvg-convert is not installed.
 *  The PNGs are checked in, so run this again only when the logo changes:
 *
 *    bun run scripts/generate-extension-icons.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const EXTENSION_DIR = path.resolve(import.meta.dir, "../src/everything-extension");
const LOGO = readFileSync(path.resolve(import.meta.dir, "../src/everything-ui/assets/logo.svg"), "utf8");
const SMALL_ICON = readFileSync(path.join(EXTENSION_DIR, "assets/icon-small.svg"), "utf8");

interface Raster {
  file: string;
  svg: string;
  size: number;
  /** How wide the SVG is drawn inside the square. The rest stays transparent. */
  artwork: number;
}

// The Chrome Web Store asks for the store-facing 128 pixel icon to carry its
// artwork at 96 by 96 inside a transparent margin. The smaller sizes fill
// their whole square. Mozilla's add-on listing wants a 128 pixel icon that
// fills its whole square. That one is written to assets/ rather than public/,
// so it never ships inside the extension zip.
const RASTERS: Raster[] = [
  { file: "public/icon/16.png", svg: SMALL_ICON, size: 16, artwork: 16 },
  { file: "public/icon/32.png", svg: SMALL_ICON, size: 32, artwork: 32 },
  { file: "public/icon/48.png", svg: LOGO, size: 48, artwork: 48 },
  { file: "public/icon/128.png", svg: LOGO, size: 128, artwork: 96 },
  { file: "assets/store-icon-128-full.png", svg: LOGO, size: 128, artwork: 128 },
];

// Chrome itself on a Mac, Playwright's own Chromium elsewhere.
const browser = await chromium.launch(process.platform === "darwin" ? { channel: "chrome" } : {});
const page = await browser.newPage();

for (const { file, svg, size, artwork } of RASTERS) {
  const inset = (size - artwork) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${artwork}px;height:${artwork}px;margin:${inset}px}</style>${svg}`,
  );
  const outPath = path.join(EXTENSION_DIR, file);
  await page.screenshot({ path: outPath, omitBackground: true });
  console.log(`wrote ${outPath}`);
}
await browser.close();
