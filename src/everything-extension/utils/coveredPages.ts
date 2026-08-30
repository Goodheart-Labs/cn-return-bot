import { browser } from "#imports";
import type { PageNoteStatusCounts } from "../../everything-shared/notesQuery";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";

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

// The per-status note counts per covered page URL. The background's sync
// writes it next to the coverage list; the listing badges and count cards sum
// whichever statuses the user's note filters show. Like the coverage list, it
// makes the decision on the user's own device. The key replaced the older
// cn:notedPageCounts, whose values were plain numbers; the new name means a
// build never misreads the other build's shape.
export const NOTED_PAGE_STATUS_COUNTS_KEY = "cn:notedPageStatusCounts";

/** Null means the counts have never been synced. */
export async function getNotedPageStatusCounts(): Promise<Record<string, PageNoteStatusCounts> | null> {
  const stored = (await browser.storage.local.get(NOTED_PAGE_STATUS_COUNTS_KEY))[NOTED_PAGE_STATUS_COUNTS_KEY];
  return stored && typeof stored === "object" ? (stored as Record<string, PageNoteStatusCounts>) : null;
}

export const trimSlash = (url: string) => url.replace(/\/$/, "");

/** This matches the same way fetchItemForUrl does. A URL must match exactly,
 *  apart from a trailing slash. A YouTube page matches by video ID. */
export function pageIsCovered(pageUrl: string, covered: string[]): boolean {
  const videoId = extractYoutubeVideoId(pageUrl);
  if (videoId) return covered.some((url) => extractYoutubeVideoId(url) === videoId);
  const trimmed = trimSlash(pageUrl);
  return covered.some((url) => trimSlash(url) === trimmed);
}
