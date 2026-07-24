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
const EXTENSION_DIR = path.resolve(import.meta.dir, "../src/everything-extension");

const svg = readFileSync(path.join(EXTENSION_DIR, "assets/icon-bold-midpills.svg"), "utf8");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
  );
  const outPath = path.join(EXTENSION_DIR, "public/icon", `${size}.png`);
  await page.screenshot({ path: outPath, omitBackground: true });
  console.log(`wrote ${outPath}`);
}
await browser.close();
