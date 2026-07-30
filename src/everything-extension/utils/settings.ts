import { browser } from "#imports";

// Which note statuses render on pages: helpful notes always show, the other
// two are the popup's tickboxes (synced across devices like the origin
// opt-ins).
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

/** Returns an unsubscribe — content-script mounts come and go with SPA
 *  navigation and must not leak listeners. */
export function onNoteFiltersChanged(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "sync" && changes[NOTE_FILTERS_KEY]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
