import { browser } from "#imports";
import type { CreatorTarget } from "./creatorTarget";

// The feed URLs of the creators whose priority window is open right now, from
// everything_projects. The background's sync writes the list next to the
// covered-pages cache, and the button surfaces read it to decide whether to
// offer a press or say we are already on it. Ingested pages are no proxy for
// that: a reader can request a single page, and that must not hide the button
// for its author.
export const PRIORITIZED_CREATOR_URLS_KEY = "cn:prioritizedCreatorUrls";

/** Null means the list has never been synced, which is the case on a fresh
 *  install. */
async function getPrioritizedCreatorUrls(): Promise<string[] | null> {
  const stored = (await browser.storage.local.get(PRIORITIZED_CREATOR_URLS_KEY))[PRIORITIZED_CREATOR_URLS_KEY];
  return Array.isArray(stored) ? (stored as string[]) : null;
}

const normalizeFeedUrl = (url: string) => url.replace(/\/$/, "").toLowerCase();

/** Adds a creator to the cached list straight after a press, so the button
 *  shows its done state immediately instead of waiting up to five minutes for
 *  the next sync to confirm what we already know. */
export async function rememberPressed(target: CreatorTarget): Promise<void> {
  const current = (await getPrioritizedCreatorUrls()) ?? [];
  if (current.some((url) => normalizeFeedUrl(url) === normalizeFeedUrl(target.feedUrl))) return;
  await browser.storage.local.set({ [PRIORITIZED_CREATOR_URLS_KEY]: [...current, target.feedUrl] });
}

/** Keeps a creator target only while their priority window is closed, so the
 *  button never offers a press for a creator we are already checking. Both
 *  sides hold the feed in the form the pipeline stores, the *.substack.com root
 *  or the YouTube channel URL, so matching is a plain lookup apart from case
 *  and a trailing slash. Before the first sync the list is unknown and the
 *  target is kept: pressing again simply extends the window, so offering it one
 *  time too many is harmless, while hiding it wrongly is not. */
export async function unlessPrioritized(target: CreatorTarget | null): Promise<CreatorTarget | null> {
  if (!target) return null;
  const prioritized = await getPrioritizedCreatorUrls();
  if (!prioritized) return target;
  const wanted = normalizeFeedUrl(target.feedUrl);
  return prioritized.some((url) => normalizeFeedUrl(url) === wanted) ? null : target;
}
