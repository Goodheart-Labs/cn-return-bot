import { browser } from "#imports";

// Origins the user has opted into beyond the static Substack/YouTube matches.
const ENABLED_ORIGINS_KEY = "cn:enabledOrigins";

export async function getEnabledOrigins(): Promise<string[]> {
  return ((await browser.storage.sync.get(ENABLED_ORIGINS_KEY))[ENABLED_ORIGINS_KEY] as string[] | undefined) ?? [];
}

export async function updateEnabledOrigins(mutate: (origins: string[]) => string[]): Promise<void> {
  await browser.storage.sync.set({ [ENABLED_ORIGINS_KEY]: mutate(await getEnabledOrigins()) });
}

export function onEnabledOriginsChanged(callback: () => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[ENABLED_ORIGINS_KEY]) callback();
  });
}

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
