/** Draws logos from the explorer into files:
 *
 *    bun run src/scripts_jim/2026_09_30_logo_explorer/export-logos.ts
 *
 *  - The logo Jim picked (CHOSEN_LOGO in js/logos.js) goes to
 *    src/everything-ui/assets/logo.svg, the logo every other icon is drawn
 *    from. After it changes, run scripts/generate-logo-assets.ts and
 *    src/everything-extension/scripts/safariAppIcons.ts.
 *  - Every candidate, at its defaults, goes to considered/explorer/<id>/, in
 *    each form the extension would ship it in.
 *
 *  The shapes are built by Paper.js inside the page, so the script starts the
 *  explorer's server on a spare port, opens the page in headless Chromium,
 *  and asks the page's own modules to draw. */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = import.meta.dir;
const REPO = path.resolve(ROOT, "../../..");
const LOGO_PATH = path.join(REPO, "src/everything-ui/assets/logo.svg");
const EXPLORER_EXPORTS = path.join(ROOT, "considered/explorer");
const PORT = 8099;
// The Chrome Web Store's artwork share of its 128 pixel icon, as in main.js.
const STORE_ARTWORK_SHARE = 96 / 128;
// The file names the "Considered logos" view reads, per form.
const FORM_FILES = { icon: "icon.svg", storeIcon: "store-icon.svg", smallIcon: "small-icon.svg", darkTile: "dark-tile.svg", menuTile: "menu-tile.svg" };
const LOGO_NOTE =
  "<!-- Common Notes logo: two rounded rectangles, green and red, with their overlap in yellow. Drawn by the logo explorer (src/scripts_jim/2026_09_30_logo_explorer/export-logos.ts) from CHOSEN_LOGO in its js/logos.js. Do not edit by hand. -->";

const server = Bun.spawn(["bun", "run", path.join(ROOT, "server.ts"), String(PORT)], { stdout: "ignore", stderr: "inherit" });
// Machines without Chromium's system libraries keep them in this folder.
const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } });
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.querySelector("#gallery button"));
  const drawn = await page.evaluate(async (storeArtworkShare) => {
    const { CANDIDATES, CHOSEN_LOGO, shippedForms } = await import("/js/logos.js");
    const formsOf = (candidate, overrides) => {
      const values = { ...candidate.defaults, ...overrides };
      return shippedForms(candidate, candidate.render(values), values, storeArtworkShare);
    };
    const chosen = CANDIDATES.find((candidate) => candidate.id === CHOSEN_LOGO.candidate);
    return {
      logo: formsOf(chosen, CHOSEN_LOGO.values).icon,
      candidates: CANDIDATES.map((candidate) => ({ id: candidate.id, forms: formsOf(candidate, {}) })),
    };
  }, STORE_ARTWORK_SHARE);

  writeFileSync(LOGO_PATH, `${drawn.logo.replace(/^(<svg[^>]*>)/, `$1\n  ${LOGO_NOTE}\n  `)}\n`);
  console.log(`wrote ${LOGO_PATH}`);
  for (const { id, forms } of drawn.candidates) {
    const folder = path.join(EXPLORER_EXPORTS, id);
    mkdirSync(folder, { recursive: true });
    for (const [form, file] of Object.entries(FORM_FILES)) writeFileSync(path.join(folder, file), forms[form]);
    console.log(`wrote ${folder}`);
  }
} finally {
  await browser.close();
  server.kill();
}
