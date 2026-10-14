import { chromium, type Browser } from "playwright";
import { STATE_DIR } from "./paths";
import { loadStaging, saveStaging } from "./staging";
import type { FeedData } from "./types";

let browser: Browser | null = null;
let shooting = false;
export async function shootPending() {
  if (shooting) return;
  shooting = true;
  try {
    if (!browser?.isConnected()) browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 720, height: 1400 }, deviceScaleFactor: 2 });
    for (;;) {
      const staging = await loadStaging();
      const next = Object.values(staging).find(s => s.shot === "pending");
      if (!next) break;
      const file = `${STATE_DIR}/shots/${next.id}.png`;
      let ok = await Bun.file(file).exists();
      if (!ok) {
        try {
          const feed: FeedData = await Bun.file(`${STATE_DIR}/feed-data.json`).json();
          await page.goto(feed[next.id]!.url, { waitUntil: "networkidle" });
          const el = page.locator(`#note-${next.id}`);
          await el.waitFor({ timeout: 15000 });
          await page.waitForTimeout(800);
          await el.evaluate((root) => {
            // The site header is sticky and would cover the top of the card
            for (const n of document.querySelectorAll<HTMLElement>("body *")) {
              if (["fixed", "sticky"].includes(getComputedStyle(n).position)) n.style.display = "none";
            }
            for (const n of root.querySelectorAll<HTMLElement>("button, a, span, div")) {
              const t = n.innerText?.trim();
              if (t === "Show surrounding context") n.style.display = "none";
              if (t?.startsWith("You don't need to be an expert")) {
                let pop: HTMLElement = n;
                while (pop.parentElement && pop.parentElement.innerText.trim().startsWith("You don't need to be an expert")) pop = pop.parentElement;
                pop.style.display = "none";
              }
              // Action row: "Show source details" before the Sept 2026 redesign, "Source details" after
              if (t === "Show source details" || t === "Source details") {
                let row: HTMLElement | null = n;
                while (row && row.parentElement && !row.parentElement.innerText.includes("Share")) row = row.parentElement;
                while (row?.parentElement && row.parentElement.innerText.trim().startsWith(t)) row = row.parentElement;
                if (row) row.style.display = "none";
              }
            }
          });
          await el.screenshot({ path: file });
          ok = true;
        } catch (e) { console.error("shot failed", next.id, String(e).slice(0, 120)); }
      }
      const fresh = await loadStaging();
      const current = fresh[next.id];
      if (current) { current.shot = ok ? "ready" : "failed"; await saveStaging(fresh); }
    }
    await page.close();
  } catch (e) {
    console.error("screenshot worker:", String(e).slice(0, 160));
  } finally { shooting = false; }
}
