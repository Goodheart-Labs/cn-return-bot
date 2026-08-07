import { browser } from "#imports";
import { isSubstackReaderUrl } from "../../everything-shared/notesQuery";

/** Resolve a Substack reader URL (substack.com/home/post/p-<id>) to the
 *  publication post URL, or null for any other URL. The fetch runs in the
 *  BACKGROUND: logged-out Substack 302s reader URLs cross-origin to the
 *  publication domain, which kills a content-script fetch (CORS applies to
 *  content scripts regardless of host permissions) — the background fetch
 *  rides the *.substack.com host permission instead. */
export async function resolveReaderCanonical(href: string): Promise<string | null> {
  if (!isSubstackReaderUrl(href)) return null;
  return (await browser.runtime.sendMessage({ type: "cn-reader-canonical", href }).catch(() => null)) ?? null;
}
