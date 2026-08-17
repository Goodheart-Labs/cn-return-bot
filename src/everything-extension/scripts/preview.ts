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
// into ~/.cache/cn-playwright-libs (no root needed) and the launcher puts
// them on the library path by itself.
import { openPageWithExtension } from "./browser";

const BADGE_WAIT_ROUNDS = 6;
const BADGE_WAIT_PER_ROUND_MS = 4000;

const [url, out, flag] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: preview.ts <url> <out.png> [--full]");
  process.exit(1);
}

const { context, page } = await openPageWithExtension(url);

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
