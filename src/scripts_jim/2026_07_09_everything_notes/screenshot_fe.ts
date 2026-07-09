// Render the everything-web dev server and screenshot it (verifies the FE
// loads data from local Supabase in a real browser).
import { chromium } from "playwright";

const OUT = process.env.SCREENSHOT_OUT ?? "/tmp/everything-web.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
const errors: string[] = [];
page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
page.on("pageerror", (err) => errors.push(String(err)));
await page.goto("http://localhost:8003/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT, fullPage: false });
console.log(`saved ${OUT}`);
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
