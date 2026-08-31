import { browser } from "#imports";

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

// The feeds the user has already asked us to follow. The status overlay and the
// popup show "follow requested" instead of offering the button again. Same
// rolling-window idea as the requested pages above.
const REQUESTED_FOLLOWS_KEY = "cn:requestedFollows";
const REQUESTED_FOLLOWS_MAX = 50;

export async function getRequestedFollows(): Promise<string[]> {
  return ((await browser.storage.sync.get(REQUESTED_FOLLOWS_KEY))[REQUESTED_FOLLOWS_KEY] as string[] | undefined) ?? [];
}

export async function addRequestedFollow(feedUrl: string): Promise<void> {
  const feeds = [...new Set([...(await getRequestedFollows()), feedUrl])];
  await browser.storage.sync.set({ [REQUESTED_FOLLOWS_KEY]: feeds.slice(-REQUESTED_FOLLOWS_MAX) });
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
function onSyncKeyChanged(key: string, callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "sync" && changes[key]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export const onNoteFiltersChanged = (callback: () => void) => onSyncKeyChanged(NOTE_FILTERS_KEY, callback);

// The general extension settings, edited on the settings page. One sync-storage
// object; reads merge over the defaults, so a key added in a later version
// gets its default for existing users without a migration.
const SETTINGS_KEY = "cn:settings";

/** The site kinds whose page visits can be recorded (see utils/linkVisits.ts). */
export type VisitSiteKind = "substack" | "youtube" | "lesswrong";

export type ExtensionSettings = {
  /** Whether opening a covered page on this kind of site writes an anonymous
   *  visit row. The settings onboarding asks about exactly these. */
  saveVisits: Record<VisitSiteKind, boolean>;
  /** The "N Common Notes on this page" card on checked pages. */
  showNoteCountOverlay: boolean;
  /** The note-count badges on listing thumbnails. */
  showThumbnailBadges: boolean;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  saveVisits: { substack: true, youtube: true, lesswrong: true },
  showNoteCountOverlay: true,
  showThumbnailBadges: true,
};

export type SettingsPatch = Partial<Omit<ExtensionSettings, "saveVisits">> & {
  saveVisits?: Partial<Record<VisitSiteKind, boolean>>;
};

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = (await browser.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY] as SettingsPatch | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    saveVisits: { ...DEFAULT_SETTINGS.saveVisits, ...stored?.saveVisits },
  };
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const current = await getSettings();
  await browser.storage.sync.set({
    [SETTINGS_KEY]: {
      ...current,
      ...patch,
      saveVisits: { ...current.saveVisits, ...patch.saveVisits },
    },
  });
}

// Whether the settings onboarding has run: the tab the background opens once,
// on install or update, so the user has seen the settings (the visit-recording
// checkboxes above all else) before any of them takes effect. Deliberately its
// own key: changing a setting must never look like finishing the onboarding,
// and vice versa.
const SETTINGS_ONBOARDING_KEY = "cn:settingsOnboardingDone";

export async function getSettingsOnboardingDone(): Promise<boolean> {
  return ((await browser.storage.sync.get(SETTINGS_ONBOARDING_KEY))[SETTINGS_ONBOARDING_KEY] as boolean | undefined) ?? false;
}

export async function markSettingsOnboardingDone(): Promise<void> {
  await browser.storage.sync.set({ [SETTINGS_ONBOARDING_KEY]: true });
}
