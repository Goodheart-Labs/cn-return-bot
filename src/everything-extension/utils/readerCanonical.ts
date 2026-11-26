import { browser } from "#imports";
import { fetchReaderCanonical, substackReaderPostId } from "@cn/core/substack";
import { storedCache } from "./storedCache";

export const READER_CANONICAL_MESSAGE_TYPE = "cn-reader-canonical";
/** The listing badges read this map directly when they mount, so a reader
 *  link they have seen before gets its badge without asking the background. */
export const READER_CANONICALS_KEY = "cn:readerPostCanonicals";
const READER_CANONICALS_MAX = 2000;

const readerCanonicals = storedCache<string>(READER_CANONICALS_KEY, READER_CANONICALS_MAX);

/** The post's own URL for a Substack reader URL, such as
 *  substack.com/home/post/p-<id>, /inbox/post/<id> or /@author/p-<id>. Null
 *  for any other URL. A post's address never changes, so each answer is
 *  cached by the post's id. Only the background and the popup may call it,
 *  because the fetch must be free of CORS (fetchReaderCanonical in
 *  @cn/core/substack). */
export function readerCanonical(href: string): Promise<string | null> {
  const postId = substackReaderPostId(href);
  return postId ? readerCanonicals.remember(postId, () => fetchReaderCanonical(href)) : Promise.resolve(null);
}

/** The same for content scripts, which ask the background. */
export async function resolveReaderCanonical(href: string): Promise<string | null> {
  if (!substackReaderPostId(href)) return null;
  return (await browser.runtime.sendMessage({ type: READER_CANONICAL_MESSAGE_TYPE, href }).catch(() => null)) ?? null;
}
