// Open the FE, capture websocket frames + button text before/after a DB-side
// count change, to see whether realtime UPDATEs reach the page.
import { chromium } from "playwright";
import { execSync } from "child_process";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("websocket", (ws) => {
  console.log(`WS OPEN ${ws.url().slice(0, 90)}`);
  ws.on("framereceived", (f) => {
    const s = String(f.payload);
    if (s.includes("postgres_changes") || s.includes("system") || s.includes("phx_reply")) {
      console.log(`<< ${s.slice(0, 220)}`);
    }
  });
});
await page.goto("http://localhost:8003/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Community Note");
await page.waitForTimeout(3000);
console.log("BUTTONS BEFORE:", await page.locator("button").allInnerTexts());

// Bump the count server-side; the page should re-render via realtime.
execSync(
  `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "update everything_notes set helpful_count = helpful_count + 10;"`,
);
await page.waitForTimeout(5000);
console.log("BUTTONS AFTER:", await page.locator("button").allInnerTexts());
execSync(
  `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "update everything_notes set helpful_count = helpful_count - 10;"`,
);
await browser.close();
