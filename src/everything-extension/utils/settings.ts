import { browser } from "#imports";

// The hostnames the user switched notes off for. The list began as the "Do not
// ask again" answer on the old grant.html consent page, back when every site
// needed its own permission. The extension now installs with access to all
// sites, and this list is the per-site opt-out that replaced that flow. The
// popup's "Hide notes on this site" button adds to it, and its "Show notes on
// this site" button removes from it. The storage key keeps its old name so an
// existing "Do not ask again" still counts as notes switched off.
const DISABLED_SITES_KEY = "cn:grantDismissed";

export async function getDisabledSites(): Promise<string[]> {
  return ((await browser.storage.sync.get(DISABLED_SITES_KEY))[DISABLED_SITES_KEY] as string[] | undefined) ?? [];
}

export async function addDisabledSite(hostname: string): Promise<void> {
  await browser.storage.sync.set({ [DISABLED_SITES_KEY]: [...new Set([...(await getDisabledSites()), hostname])] });
}

export async function removeDisabledSite(hostname: string): Promise<void> {
  await browser.storage.sync.set({ [DISABLED_SITES_KEY]: (await getDisabledSites()).filter((h) => h !== hostname) });
}

/** Returns a function that removes the listener again. The background watches
 *  this so a toggled site is registered or unregistered right away. */
export function onDisabledSitesChanged(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "sync" && changes[DISABLED_SITES_KEY]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

// The pages the user has already asked us to cover with "Request notes on this
// page". Reopening the popup on such a page shows the done state instead of creating
// a second request. The list is a rolling window. Sync storage allows about 8KB per
// key, so we only remember the most recent requests.
const REQUESTED_PAGES_KEY = "cn:requestedPages";
const REQUESTED_PAGES_MAX = 50;

export async function getRequestedPages(): Promise<string[]> {
  return ((await browser.storage.sync.get(REQUESTED_PAGES_KEY))[REQUESTED_PAGES_KEY] as string[] | undefined) ?? [];
}

export async function addRequestedPage(pageUrl: string): Promise<void> {
  const pages = [...new Set([...(await getRequestedPages()), pageUrl])];
  await browser.storage.sync.set({ [REQUESTED_PAGES_KEY]: pages.slice(-REQUESTED_PAGES_MAX) });
}

// Which note statuses are rendered on a page. Notes rated helpful always show. The
// other two statuses are controlled by tickboxes in the popup. The setting lives in
// sync storage, so it follows the user across devices.
const NOTE_FILTERS_KEY = "cn:noteFilters";

export type NoteFilters = { showNeedsRatings: boolean; showUnhelpful: boolean };
const DEFAULT_NOTE_FILTERS: NoteFilters = { showNeedsRatings: true, showUnhelpful: false };

export async function getNoteFilters(): Promise<NoteFilters> {
  const stored = (await browser.storage.sync.get(NOTE_FILTERS_KEY))[NOTE_FILTERS_KEY] as Partial<NoteFilters> | undefined;
  return { ...DEFAULT_NOTE_FILTERS, ...stored };
}

export async function updateNoteFilters(patch: Partial<NoteFilters>): Promise<void> {
  await browser.storage.sync.set({ [NOTE_FILTERS_KEY]: { ...(await getNoteFilters()), ...patch } });
}

/** Returns a function that removes the listener again. Content-script mounts come and
 *  go as the user navigates a single-page app, and they must not leak listeners. */
export function onNoteFiltersChanged(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "sync" && changes[NOTE_FILTERS_KEY]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
