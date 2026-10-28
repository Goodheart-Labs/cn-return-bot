import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { typefully } from "./typefully";

/* The local posting tool (GOO-629). `bun run note-tweets` starts two servers
 * on the admin's computer:
 *   - the website on SITE_PORT against the production database, with the
 *     address of this server, which switches on the review page's Post on X
 *     button and its note picture page;
 *   - this server on SERVER_PORT, which holds the Typefully key. It takes a
 *     picture of a note's card from the website's picture page, and sends a
 *     tweet with it to Typefully.
 * The browser marks the note as posted on X after a send, with the admin's
 * own sign-in. The pictures stay in .state/, which git ignores. Playwright
 * needs its browser once: `bunx playwright install chromium`. */

const SITE_PORT = 8003;
const SERVER_PORT = 8010;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const IMAGE_DIR = new URL("./.state/images/", import.meta.url).pathname;
/** The picture is taken at twice the CSS size, for sharp text. */
const IMAGE_SCALE = 2;
const IMAGE_TIMEOUT_MS = 20_000;
const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const createDraft = typefully();
await mkdir(IMAGE_DIR, { recursive: true });
const imagePath = (noteId: string) => `${IMAGE_DIR}${noteId}.png`;

let browser: Browser | null = null;

/** Opens the note's picture page and saves a picture of its card. */
async function takeImage(noteId: string): Promise<void> {
  if (!browser?.isConnected()) browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: IMAGE_SCALE });
  try {
    await page.goto(`${SITE}/note-image/${noteId}`);
    const card = page.locator("[data-note-image]");
    await card.waitFor({ timeout: IMAGE_TIMEOUT_MS });
    await page.waitForLoadState("networkidle");
    await card.screenshot({ path: imagePath(noteId) });
  } finally {
    await page.close();
  }
}

const CORS = { "Access-Control-Allow-Origin": SITE, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST" };
const answer = (body: BodyInit | null, init: ResponseInit = {}) => new Response(body, { ...init, headers: { ...CORS, ...init.headers } });

async function noteIdOf(request: Request): Promise<{ noteId: string } & Record<string, unknown>> {
  const body = (await request.json()) as { noteId?: unknown } & Record<string, unknown>;
  if (typeof body.noteId !== "string" || !NOTE_ID.test(body.noteId)) throw new Error("noteId must be a note's id");
  return body as { noteId: string } & Record<string, unknown>;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: SERVER_PORT,
  idleTimeout: 120,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return answer(null, { status: 204 });
    try {
      const image = pathname.match(/^\/images\/([0-9a-f-]{36})\.png$/);
      if (image && request.method === "GET") return answer(Bun.file(imagePath(image[1]!)), { headers: { "content-type": "image/png" } });
      if (pathname === "/image" && request.method === "POST") {
        const { noteId } = await noteIdOf(request);
        await takeImage(noteId);
        return answer(JSON.stringify({ url: `/images/${noteId}.png?at=${Date.now()}` }), { headers: { "content-type": "application/json" } });
      }
      if (pathname === "/send" && request.method === "POST") {
        const { noteId, text, reply, timing } = await noteIdOf(request);
        if (typeof text !== "string" || !text.trim()) throw new Error("The tweet is empty");
        const draft = await createDraft({
          text,
          reply: typeof reply === "string" ? reply : "",
          image: await Bun.file(imagePath(noteId)).arrayBuffer(),
          title: `Common Note ${noteId}`,
          timing: timing === "now" ? "now" : "next_free_slot",
        });
        return answer(JSON.stringify(draft), { headers: { "content-type": "application/json" } });
      }
      return answer("Not found", { status: 404 });
    } catch (error) {
      return answer(error instanceof Error ? error.message : String(error), { status: 500 });
    }
  },
});

const site = Bun.spawn(["bunx", "vite", "--port", String(SITE_PORT), "--host", "127.0.0.1", "--strictPort", "--mode", "prod-backend"], {
  cwd: new URL("../everything-web/", import.meta.url).pathname,
  env: { ...process.env, VITE_TWEET_SERVER: SERVER },
  stdout: "inherit",
  stderr: "inherit",
});
const stop = () => {
  site.kill();
  void browser?.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(`Posting tool: open ${SITE}/admin/notes and sign in as an admin.`);
await site.exited;
process.exit(site.exitCode ?? 1);
