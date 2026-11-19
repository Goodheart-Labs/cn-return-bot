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
import { openPageWithExtension, waitForBadges } from "./browser";

const [url, out, flag] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: preview.ts <url> <out.png> [--full]");
  process.exit(1);
}

const { context, page } = await openPageWithExtension(url);

console.log(`${await waitForBadges(page)} coverage badge(s) on the page`);

await page.screenshot({ path: out, fullPage: flag === "--full" });
console.log(`screenshot: ${out}`);
await context.close();
