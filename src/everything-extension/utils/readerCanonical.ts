import { browser } from "#imports";
import { isSubstackReaderUrl } from "../../everything-shared/pageUrls";

/** Turns a Substack reader URL of the form substack.com/home/post/p-<id> into the
 *  publication's own post URL. Any other URL returns null. The fetch runs in the
 *  background script. When the reader is logged out, Substack answers a reader URL
 *  with a redirect to the publication's own domain. A content script cannot follow
 *  that redirect, because CORS applies to content scripts whatever host permissions
 *  they hold. The background fetch may follow it under the *.substack.com host
 *  permission. */
export async function resolveReaderCanonical(href: string): Promise<string | null> {
  if (!isSubstackReaderUrl(href)) return null;
  return (await browser.runtime.sendMessage({ type: "cn-reader-canonical", href }).catch(() => null)) ?? null;
}
