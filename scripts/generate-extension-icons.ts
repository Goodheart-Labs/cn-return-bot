/** Rasterize the extension icon SVG into the PNG sizes the manifest needs.
 *  Chrome-via-playwright because that's already a repo dependency and macOS
 *  has no reliable CLI SVG rasterizer (sips mangles SVGs; rsvg-convert isn't
 *  installed). The PNGs are checked in — rerun only when icon.svg changes:
 *
 *    bun run scripts/generate-extension-icons.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SIZES = [16, 32, 48, 128];
// Chrome Web Store guidance: the store-facing 128 carries its artwork at
// 96×96 inside a transparent margin; toolbar sizes stay full-bleed.
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
// AMO's listing icon wants full-bleed 128 (no CWS-style padding). Lives in
// assets/ (not public/) so it never ships inside the extension zip.
await render(128, 128, path.join(EXTENSION_DIR, "assets/store-icon-128-full.png"));
await browser.close();
