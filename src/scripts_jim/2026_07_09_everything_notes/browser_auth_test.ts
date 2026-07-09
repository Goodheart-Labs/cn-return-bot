// Full logged-in FE flow in a real browser: sign in (via the magic-link URL
// hash that Supabase auto-detects), vote, and submit an earnest improvement,
// verifying the accepted suggestion appears live.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const APP = "http://localhost:8003";
const URL = "http://127.0.0.1:54321";
const ANON = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.SUPABASE_SECRET_KEY ?? (() => { throw new Error("set SUPABASE_SECRET_KEY (local sb_secret_… from `supabase status`)"); })();
const OUT = process.env.SCREENSHOT_OUT ?? "/tmp/common-notes-authed.png";

const admin = createClient(URL, SERVICE);
const email = `browser+${Date.now().toString(36)}@example.com`;
const password = "password123";
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data } = await createClient(URL, ANON).auth.signInWithPassword({ email, password });
const s = data.session!;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

// Land exactly like a magic-link click: Supabase (detectSessionInUrl) consumes the hash.
const hash = `#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`;
await page.goto(`${APP}/${hash}`, { waitUntil: "domcontentloaded" });

await page.waitForSelector(`text=Signed in as ${email}`, { timeout: 10000 });
console.log("✅ signed in (magic-link hash consumed)");

// Vote on the first note.
await page.locator("button[aria-label^='Helpful ratings']").first().click();
await page.waitForSelector("button[aria-label='Helpful ratings: 1']", { timeout: 8000 });
console.log("✅ vote registered with live count");

// Suggest an earnest improvement on the first note; on accept it REPLACES the
// note text in the UI (no separate block).
const marker = `CLARIFYING EDIT ${Date.now().toString(36)}`;
await page.locator("button:has-text('Suggest an improvement')").first().click();
await page.locator("textarea").first().fill(
  `${marker}: this note is accurate; adding a one-line note on why the dating matters would make it clearer.`,
);
await page.locator("button:has-text('Submit')").first().click();
// On accept the editor closes and the marker appears inside the note box
// (the blue OurNoteCard), replacing the original text — not just in the textarea.
await page.waitForSelector(`.bg-blue-50:has-text("${marker}")`, { timeout: 20000 });
console.log("✅ earnest improvement accepted and replaced the note text live");

await page.screenshot({ path: OUT, fullPage: false });
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
console.log(`saved ${OUT}`);

await browser.close();
await admin.auth.admin.deleteUser(s.user.id);
