/**
 * Detects X's "Made with AI" media-provenance label on a post. The label only
 * exists in X's web interface.
 *
 * X's API does not expose the label. So we load the post's status page logged
 * out, in a fresh browser context that behaves like an incognito window, and look
 * for the label inside the focused tweet's article. The label renders as a leaf
 * span whose text is exactly "Made with AI". It sits between the post body and
 * the timestamp.
 *
 * The check fails open. Any navigation or render error returns false, so a flaky
 * page load never blocks note generation. The same holds when X serves our
 * datacenter IP a login wall instead of the post.
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
    await page.waitForSelector("article", { timeout: ARTICLE_TIMEOUT_MS });

    // Search only the focused tweet, which is the first rendered article, and
    // ignore that tweet's own body text. Otherwise a post that merely says the
    // words "Made with AI" would be mistaken for the provenance label.
    //
    // X's logged-out status page is a lightweight server-rendered view. Its tweet
    // is a bare article element with no data-testid attributes, so matching on the
    // element name is all we can do. The focused tweet is always the first article.
    const article = page.locator("article").first();
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
