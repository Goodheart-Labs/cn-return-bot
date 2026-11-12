import { browser } from "#imports";

export interface CapturedPage {
  href: string;
  /** The page's <link rel="canonical"> target, or null. */
  canonical: string | null;
  title: string;
  /** The page's readable body text. The pipeline fact-checks a requested page
   *  from this text, because it cannot fetch arbitrary pages from CI. The
   *  database column limit is applied by submitNoteRequest, not here. */
  text: string;
}

/** Reads what a note request needs from the current page. This function runs
 *  in two worlds: called directly by content scripts, and injected into the
 *  active tab with scripting.executeScript by the popup and the background.
 *  executeScript serializes the function source, so it must stay
 *  self-contained; an import, or a constant outside it, would not exist on the
 *  other side. */
export function readPageForRequest(): CapturedPage {
  // Sites mark the part of a page that holds the post with <article> or
  // <main>, but many also wrap each comment, card or related post in its own
  // <article>. The EA Forum wraps nothing around its post, so its first
  // <article> is a related post's card. The post is the part that holds the
  // page's most important heading. So we take the most important heading
  // level that appears inside such a part, find for every heading of that
  // level the innermost part around it, and keep the longest of those parts.
  // Taking the innermost part keeps a <main> from winning over the <article>
  // inside it, which would add the comments and related links. A page with no
  // heading in any part gives its longest part, and a page without parts gives
  // the whole body.
  const PARTS = "article, main, [role=main]";
  const textLength = (element: Element) => (element as HTMLElement).innerText.length;
  const longest = (elements: Element[]) =>
    elements.reduce<Element | undefined>((best, element) => (!best || textLength(element) > textLength(best) ? element : best), undefined);
  let container: Element | undefined;
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    container = longest([...document.querySelectorAll(level)].flatMap((heading) => heading.closest(PARTS) ?? []));
    if (container) break;
  }
  container ??= longest([...document.querySelectorAll(PARTS)]) ?? document.body;
  return {
    href: location.href,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    title: document.title,
    text: (container as HTMLElement).innerText.trim(),
  };
}

/** Injects readPageForRequest into a tab. Returns null on a page we may not
 *  inject into, such as chrome:// and the extension stores; the caller then
 *  falls back to the tab's url and title without body text. */
export async function capturePageFromTab(tabId: number): Promise<CapturedPage | null> {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readPageForRequest });
    return (result?.result as CapturedPage) ?? null;
  } catch {
    return null;
  }
}
