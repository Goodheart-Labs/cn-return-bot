/**
 * Does a browser we start ourselves get past the EA Forum's bot check
 * (Vercel's Security Checkpoint), and which kind of browser does?
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/browserProbe.ts [--box] [--mode shell|new|headed] [--own-ua] [--hide-automation]
 *
 * --box             send everything out through the services box's address. It needs
 *                   `ssh -N -D 127.0.0.1:1081 root@<services box>` running.
 * --mode shell      Playwright's default: the old headless mode, a separate
 *                   binary called the headless shell. This is what cn-fetch runs.
 * --mode new        the full Chromium binary in the new headless mode.
 * --mode headed     the full Chromium binary with a window (run under xvfb-run).
 * --own-ua          keep the browser's own user agent instead of the ladder's
 *                   Mac Chrome 131 one. A headless Chromium calls itself
 *                   "HeadlessChrome" there.
 * --chrome-ua       the browser's own user agent with "HeadlessChrome" replaced
 *                   by "Chrome", so what a Chromium with a window would send.
 * --hide-automation start Chromium without the flag that sets navigator.webdriver.
 */

import { chromium } from "playwright";
import { FETCH_UAS } from "../../pipeline/fetch/fetchLadder";

const ORIGIN = "https://forum.effectivealtruism.org";
const QUERY = `${ORIGIN}/graphql?query=${encodeURIComponent('{ posts(input:{terms:{view:"new",limit:2}}){results{_id title}}}')}`;
const BOX_PROXY = "socks5://127.0.0.1:1081";
const PATIENCE_MS = 40_000;
const RETRY_MS = 2_000;

const args = process.argv.slice(2);
const mode = args[args.indexOf("--mode") + 1] ?? "shell";
const throughBox = args.includes("--box");
const ownUa = args.includes("--own-ua");
const chromeUa = args.includes("--chrome-ua");
const hideAutomation = args.includes("--hide-automation");

const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1).padStart(5)}s`;

const browser = await chromium.launch({
  handleSIGTERM: false,
  headless: mode !== "headed",
  ...(mode !== "shell" && { channel: "chromium" }),
  ...(throughBox && { proxy: { server: BOX_PROXY } }),
  ...(hideAutomation && { args: ["--disable-blink-features=AutomationControlled"] }),
});
const majorVersion = browser.version().split(".")[0];
const userAgent = chromeUa ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36` : FETCH_UAS.desktop;
const context = await browser.newContext({ ...(!ownUa && { userAgent }), locale: "en-US" });
const page = await context.newPage();

page.on("response", (response) => {
  const url = response.url();
  const isDocument = response.request().resourceType() === "document";
  if (!isDocument && !url.includes("/.well-known/vercel/")) return;
  console.log(`${elapsed()}  ${response.status()} ${response.headers()["x-vercel-mitigated"] ?? "-"}  ${response.request().method()} ${url.slice(0, 110)}`);
});

console.log(`mode=${mode} through=${throughBox ? "services box" : "this machine"} ua=${ownUa ? "browser's own" : chromeUa ? "Chrome on Linux" : "ladder's"} hideAutomation=${hideAutomation}`);
await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((err) => console.log(`${elapsed()}  goto failed: ${err.message.slice(0, 120)}`));

const deadline = Date.now() + PATIENCE_MS;
let outcome = "the bot check never let the request through";
while (Date.now() < deadline) {
  const answer = await page
    .evaluate(async (address) => {
      const response = await fetch(address, { headers: { Accept: "application/json" } });
      return { status: response.status, mitigated: response.headers.get("x-vercel-mitigated"), body: (await response.text()).slice(0, 120) };
    }, QUERY)
    .catch((err) => ({ status: 0, mitigated: "lost", body: err.message.slice(0, 80) }));
  console.log(`${elapsed()}  in-page GraphQL: ${answer.status} ${answer.mitigated ?? "-"} ${answer.status === 200 ? answer.body : ""}`);
  if (answer.status === 200) {
    outcome = "PASSED";
    break;
  }
  await page.waitForTimeout(RETRY_MS);
}

const seen = await page.evaluate(() => ({ title: document.title, webdriver: navigator.webdriver, ua: navigator.userAgent })).catch(() => null);
console.log(`${elapsed()}  ${outcome}. title=${JSON.stringify(seen?.title)} navigator.webdriver=${seen?.webdriver} ua=${seen?.ua}`);
console.log(`cookies: ${(await context.cookies()).map((cookie) => cookie.name).join(", ") || "none"}`);
await browser.close();
