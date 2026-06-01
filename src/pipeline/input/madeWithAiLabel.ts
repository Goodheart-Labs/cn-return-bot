/**
 * Detect X's UI-only "Made with AI" media-provenance label on a post.
 *
 * X's API does not expose this label, so we load the logged-out status page in a
 * fresh (incognito-equivalent) browser context and look for the label inside the
 * focused tweet's article. The label renders as a leaf <span> whose text is
 * exactly "Made with AI", sitting between the post body and the timestamp.
 *
 * Fails open: any navigation/render error returns false so a flaky page load (or
 * a datacenter IP being served a login wall) never blocks note generation.
 */
import { getBrowser } from "../utils/browserManager";

const LABEL_TEXT = "Made with AI";
const NAV_TIMEOUT_MS = 25_000;
const ARTICLE_TIMEOUT_MS = 15_000;
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function detectMadeWithAiLabel(tweetId: string, logTag: string): Promise<boolean> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: DESKTOP_UA,
    viewport: { width: 1280, height: 1600 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`https://x.com/i/status/${tweetId}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: ARTICLE_TIMEOUT_MS });

    // Scope to the focused (primary) tweet — the first rendered tweet article —
    // and ignore the post's own body text, so a post that merely *says* "Made
    // with AI" can't be mistaken for the media-provenance label.
    const article = page.locator('article[data-testid="tweet"]').first();
    return await article.evaluate((root, labelText) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null = walker.currentNode;
      while (node) {
        const el = node as HTMLElement;
        if (
          (el.textContent ?? "").trim() === labelText &&
          !el.closest('[data-testid="tweetText"]') &&
          !Array.from(el.children).some((c) => (c.textContent ?? "").trim() === labelText)
        ) {
          return true;
        }
        node = walker.nextNode();
      }
      return false;
    }, LABEL_TEXT);
  } catch (err: any) {
    console.warn(`[${logTag}] "Made with AI" label check failed: ${err?.message ?? err} (assuming no label)`);
    return false;
  } finally {
    await context.close();
  }
}
