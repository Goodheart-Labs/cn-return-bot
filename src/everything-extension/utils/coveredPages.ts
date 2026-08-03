import { browser } from "#imports";
import { extractYoutubeVideoId } from "../../everything-shared/notesQuery";

// The covered-pages list (every ingested item URL), written by the
// background's sync and read by content scripts BEFORE any backend call —
// the privacy point: whether a page has notes is decided on-device, so
// ordinary browsing never reaches our server.
export const COVERED_PAGE_URLS_KEY = "cn:coveredPageUrls";

/** Null = never synced (fresh install): callers may fall back to a live
 *  lookup rather than hiding notes until the first sync lands. */
export async function getCoveredPageUrls(): Promise<string[] | null> {
  const stored = (await browser.storage.local.get(COVERED_PAGE_URLS_KEY))[COVERED_PAGE_URLS_KEY];
  return Array.isArray(stored) ? (stored as string[]) : null;
}

const trimSlash = (url: string) => url.replace(/\/$/, "");

/** Same matching semantics as fetchItemForUrl: exact URL up to a trailing
 *  slash, YouTube by video ID. */
export function pageIsCovered(pageUrl: string, covered: string[]): boolean {
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) return covered.some((url) => extractYoutubeVideoId(url) === videoId);
  const trimmed = trimSlash(pageUrl);
  return covered.some((url) => trimSlash(url) === trimmed);
}
