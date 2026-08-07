import { browser } from "#imports";
import { extractYoutubeVideoId } from "../../everything-shared/notesQuery";

// The covered-pages list holds the URL of every ingested item. The background's
// sync writes it, and content scripts read it before they make any backend
// call. This is the privacy point. Whether a page has notes is decided on the
// user's own device, so ordinary browsing never reaches our server.
export const COVERED_PAGE_URLS_KEY = "cn:coveredPageUrls";

/** Null means the list has never been synced, which is the case on a fresh
 *  install. A caller may then fall back to a live lookup instead of hiding
 *  notes until the first sync lands. */
export async function getCoveredPageUrls(): Promise<string[] | null> {
  const stored = (await browser.storage.local.get(COVERED_PAGE_URLS_KEY))[COVERED_PAGE_URLS_KEY];
  return Array.isArray(stored) ? (stored as string[]) : null;
}

const trimSlash = (url: string) => url.replace(/\/$/, "");

/** This matches the same way fetchItemForUrl does. A URL must match exactly,
 *  apart from a trailing slash. A YouTube page matches by video ID. */
export function pageIsCovered(pageUrl: string, covered: string[]): boolean {
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) return covered.some((url) => extractYoutubeVideoId(url) === videoId);
  const trimmed = trimSlash(pageUrl);
  return covered.some((url) => trimSlash(url) === trimmed);
}
