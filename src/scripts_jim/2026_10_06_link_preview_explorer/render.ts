/** Renders every card in cards/ to images/<name>.png at twice its size, the
 *  way scripts/generate-logo-assets.ts renders the live og.png. The current
 *  card is rendered from the website's own og-card.html.
 *
 *    bun run src/scripts_jim/2026_10_06_link_preview_explorer/render.ts
 */
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = import.meta.dir;
const CARD = { width: 1200, height: 630, scale: 2 };
const CARDS = [
  { name: "current", file: path.resolve(HERE, "../../everything-web/og-card.html") },
  ...readdirSync(path.join(HERE, "cards"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({ name: file.replace(/\.html$/, ""), file: path.join(HERE, "cards", file) })),
];

const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({
  env: { ...process.env, LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
});
const page = await browser.newPage({
  viewport: { width: CARD.width, height: CARD.height },
  deviceScaleFactor: CARD.scale,
});
for (const { name, file } of CARDS) {
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(HERE, "images", `${name}.png`);
  await page.screenshot({ path: out });
  console.log(`${out} ${Math.round(statSync(out).size / 1024)} KB`);
}
await browser.close();
