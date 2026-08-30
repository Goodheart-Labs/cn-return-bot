import { browser } from "#imports";
import { isSubstackReaderUrl } from "../../everything-shared/pageUrls";

/** Turns a Substack reader URL, such as substack.com/home/post/p-<id> or
 *  /@author/p-<id>, into the publication's own post URL. Any other URL returns
 *  null. The fetch runs in the background script, because CORS applies to
 *  content scripts whatever host permissions they hold; how the resolution
 *  works is described on fetchReaderCanonical in notesQuery.ts. */
export async function resolveReaderCanonical(href: string): Promise<string | null> {
  if (!isSubstackReaderUrl(href)) return null;
  return (await browser.runtime.sendMessage({ type: "cn-reader-canonical", href }).catch(() => null)) ?? null;
}
