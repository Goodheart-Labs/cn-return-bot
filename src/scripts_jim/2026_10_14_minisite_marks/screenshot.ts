// Screenshots a live minisite on a wide screen and lists, in page order, every
// underline and every margin card with its vertical position.
// Usage: bun run <this file> <url> <out.png>
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const WIDE_VIEWPORT = { width: 1440, height: 1000 };
const SETTLE_MS = 6000;
const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
process.env.LD_LIBRARY_PATH = [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");

const browser = await chromium.launch({ executablePath: path.join(os.homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome") });
const page = await browser.newPage({ viewport: WIDE_VIEWPORT });
await page.goto(url!, { waitUntil: "networkidle" });
await page.waitForTimeout(SETTLE_MS);
const layout = await page.evaluate(() => {
  const top = (el: Element) => Math.round(el.getBoundingClientRect().top + window.scrollY);
  const marks = [...document.querySelectorAll("[data-mark]")].map((el) => ({ what: `mark ${el.getAttribute("data-mark")}`, top: top(el), passage: el.closest(".reader-passage")?.id, text: el.textContent!.slice(0, 60) }));
  const cards = [...document.querySelectorAll(".reader-margin-group > *")].map((el) => ({ what: "card", top: top(el), passage: el.closest(".reader-passage")?.id, text: el.textContent!.slice(0, 60) }));
  const passages = [...document.querySelectorAll(".reader-passage")].map((el) => ({ what: "passage", top: top(el), passage: el.id, text: el.querySelector("p, li, h2, h3, blockquote")?.textContent?.slice(0, 60) ?? "" }));
  return [...marks, ...cards, ...passages].sort((a, b) => a.top - b.top);
});
for (const row of layout) console.log(String(row.top).padStart(6), row.what.padEnd(16), (row.passage ?? "").padEnd(22), row.text.replace(/\s+/g, " "));
await page.screenshot({ path: out!, fullPage: true });
await browser.close();
