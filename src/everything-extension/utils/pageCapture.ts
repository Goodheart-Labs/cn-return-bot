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

/** Reads what a note request needs from the current page. Prefers the article
 *  element so navigation chrome stays out of the body text. This function runs
 *  in two worlds: called directly by content scripts, and injected into the
 *  active tab with scripting.executeScript by the popup and the background.
 *  executeScript serializes the function source, so it must stay
 *  self-contained; an import would not exist on the other side. */
export function readPageForRequest(): CapturedPage {
  const container =
    document.querySelector<HTMLElement>("article") ?? document.querySelector<HTMLElement>("main") ?? document.body;
  return {
    href: location.href,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    title: document.title,
    text: (container?.innerText ?? "").trim(),
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
