// Verify Common Notes deep-linking: project selection updates the URL, Share
// copies a note link, and opening that link lands on the right project scrolled
// to the note.
import { chromium } from "playwright";

const APP = "http://localhost:8003";
const b = await chromium.launch();
const ctx = await b.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const p = await ctx.newPage();

// 1. Selecting a project updates the URL.
await p.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("text=The Dwarkesh Podcast");
await p.click("text=Zvi Mowshowitz's newsletter");
await p.waitForFunction(() => new URLSearchParams(location.search).get("project") === "zvi");
console.log("✅ selecting a project sets ?project=zvi");
await p.click("text=The Dwarkesh Podcast");
await p.waitForFunction(() => new URLSearchParams(location.search).get("project") === "dwarkesh");
console.log("✅ back to ?project=dwarkesh");

// 2. Share copies a ?project=&note= link for a specific (lower) note.
const shareButtons = p.locator("button:has-text('Share')");
const targetIdx = 4; // a note further down, so we can prove the scroll
await shareButtons.nth(targetIdx).click();
await p.waitForSelector("button:has-text('Link copied')");
const link = await p.evaluate(() => navigator.clipboard.readText());
console.log("✅ Share copied:", link);
if (!/[?&]project=dwarkesh&note=[0-9a-f-]{36}/.test(link)) throw new Error("share link malformed");

// 3. Opening the link in a fresh page scrolls that note into view.
const p2 = await ctx.newPage();
await p2.goto(link, { waitUntil: "domcontentloaded" });
const noteId = new URL(link).searchParams.get("note");
await p2.waitForSelector(`#note-${noteId}`);
await p2.waitForTimeout(1200); // smooth scroll settles
const visible = await p2.evaluate((id) => {
  const el = document.getElementById(`note-${id}`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= -5 && r.top < window.innerHeight * 0.6; // near the top of the viewport
}, noteId);
console.log(visible ? "✅ shared link scrolled the note into view" : "❌ note not scrolled into view");

await b.close();
