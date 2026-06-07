/**
 * Detect X's UI-only "Made with AI" media-provenance label on a tweet.
 *
 * The X API does not expose this label (see probe.ts / fetchOne.ts), so we load
 * the logged-out status page in a fresh (incognito-equivalent) browser context
 * and look for the label inside the focused tweet's article.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_06_01_ai_media_label_probe/madeWithAi.ts <tweetIdOrUrl> [...]
 *   bun run src/scripts_jim/2026_06_01_ai_media_label_probe/madeWithAi.ts --debug <tweetIdOrUrl>
 */
import { chromium } from "playwright";

const LABEL_TEXT = "Made with AI";
const NAV_TIMEOUT_MS = 30_000;
const ARTICLE_TIMEOUT_MS = 20_000;
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface DetectionResult {
  tweetId: string;
  hasAiLabel: boolean;
  error?: string;
  matches?: { tag: string; text: string; testid: string | null; ariaLabel: string | null }[];
}

function toTweetId(arg: string): string {
  const fromUrl = arg.match(/status\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return arg.replace(/\D/g, "");
}

async function detect(
  context: import("playwright").BrowserContext,
  tweetId: string,
  debug: boolean,
): Promise<DetectionResult> {
  const page = await context.newPage();
  try {
    await page.goto(`https://x.com/i/status/${tweetId}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: ARTICLE_TIMEOUT_MS });

    // Scope to the focused (primary) tweet: the first rendered tweet article.
    const article = page.locator('article[data-testid="tweet"]').first();

    // Find every element inside the article whose own text is exactly the label.
    // Reporting tag/testid/aria lets us tighten the selector after seeing real DOM.
    const matches = await article.evaluate((root, labelText) => {
      const hits: { tag: string; text: string; testid: string | null; ariaLabel: string | null }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode as HTMLElement | null;
      while (node) {
        const el = node as HTMLElement;
        const own = (el.textContent ?? "").trim();
        // Ignore the tweet's own body text so a post that merely says "Made with
        // AI" can't be mistaken for the media-provenance label.
        if (own === labelText && !el.closest('[data-testid="tweetText"]')) {
          // Keep only the tightest element (no child also matches) to avoid dupes.
          const childMatches = Array.from(el.children).some(
            (c) => (c.textContent ?? "").trim() === labelText,
          );
          if (!childMatches) {
            hits.push({
              tag: el.tagName.toLowerCase(),
              text: own.slice(0, 80),
              testid: el.getAttribute("data-testid"),
              ariaLabel: el.getAttribute("aria-label"),
            });
          }
        }
        node = walker.nextNode() as HTMLElement | null;
      }
      return hits;
    }, LABEL_TEXT);

    const result: DetectionResult = { tweetId, hasAiLabel: matches.length > 0 };
    if (debug) {
      result.matches = matches;
      const text = await article.innerText();
      console.log(`\n----- [${tweetId}] focused-article innerText -----\n${text}\n----------`);
    }
    return result;
  } catch (err: any) {
    return { tweetId, hasAiLabel: false, error: err?.message ?? String(err) };
  } finally {
    await page.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const debug = args.includes("--debug");
  const targets = args.filter((a) => a !== "--debug").map(toTweetId).filter(Boolean);

  if (targets.length === 0) {
    console.error("usage: madeWithAi.ts [--debug] <tweetIdOrUrl> [...]");
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: DESKTOP_UA, viewport: { width: 1280, height: 1600 } });
  try {
    for (const id of targets) {
      const r = await detect(context, id, debug);
      const verdict = r.error ? `ERROR: ${r.error}` : r.hasAiLabel ? "Made with AI: YES" : "Made with AI: no";
      console.log(`${id}  ${verdict}`);
      if (debug && r.matches?.length) console.log(JSON.stringify(r.matches, null, 2));
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
