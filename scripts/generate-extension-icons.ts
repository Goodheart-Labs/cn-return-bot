/** Turn the extension's icon SVG into the PNG sizes the manifest needs.
 *  It renders through Chrome with Playwright, because Playwright is already a
 *  dependency of this repo. macOS has no reliable command line SVG rasterizer.
 *  sips mangles SVGs, and rsvg-convert is not installed.
 *  The PNGs are checked in, so run this again only when the icon SVG changes:
 *
 *    bun run scripts/generate-extension-icons.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SIZES = [16, 32, 48, 128];
// The Chrome Web Store asks for the store-facing 128 pixel icon to carry its
// artwork at 96 by 96 inside a transparent margin. The smaller toolbar sizes
// fill their whole square.
const ARTWORK_SIZE: Record<number, number> = { 128: 96 };
const EXTENSION_DIR = path.resolve(import.meta.dir, "../src/everything-extension");

const svg = readFileSync(path.join(EXTENSION_DIR, "assets/icon-bold-midpills.svg"), "utf8");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function render(size: number, artwork: number, outPath: string) {
  const inset = (size - artwork) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${artwork}px;height:${artwork}px;margin:${inset}px}</style>${svg}`,
  );
  await page.screenshot({ path: outPath, omitBackground: true });
  console.log(`wrote ${outPath}`);
}

for (const size of SIZES) {
  await render(size, ARTWORK_SIZE[size] ?? size, path.join(EXTENSION_DIR, "public/icon", `${size}.png`));
}
// Mozilla's add-on listing wants a 128 pixel icon that fills its whole square,
// without the padding the Chrome Web Store asks for. It is written to assets/
// rather than public/, so it never ships inside the extension zip.
await render(128, 128, path.join(EXTENSION_DIR, "assets/store-icon-128-full.png"));
await browser.close();
