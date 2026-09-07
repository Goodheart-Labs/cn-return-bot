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

// Which note statuses are rendered on a page. Notes rated helpful always show. The
// other two statuses are controlled by tickboxes in the popup. The setting lives in
// sync storage, so it follows the user across devices.
const NOTE_FILTERS_KEY = "cn:noteFilters";

export type NoteFilters = { showNeedsRatings: boolean; showUnhelpful: boolean };
// Both filters default on since 2026-08-31 (Jim's call): a fresh install shows
// unhelpful notes too, and hiding them is the opt-in.
const DEFAULT_NOTE_FILTERS: NoteFilters = { showNeedsRatings: true, showUnhelpful: true };

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

/** Fires when the general settings object changes, on every context. The note
 *  mounts use it to flip between the margin and classic note styles without a
 *  reload. */
export const onSettingsChanged = (callback: () => void) => onSyncKeyChanged(SETTINGS_KEY, callback);

// The general extension settings, edited on the settings page. One sync-storage
// object; reads merge over the defaults, so a key added in a later version
// gets its default for existing users without a migration.
const SETTINGS_KEY = "cn:settings";

/** The site kinds whose page visits can be recorded (see utils/linkVisits.ts). */
export type VisitSiteKind = "substack" | "youtube" | "lesswrong";

/** How notes render on article pages. "margin" is the default: a small marker
 *  in the right margin, and the note card opens beside the text. "classic" is
 *  the old style: a badge at the end of the passage, and the card opens as a
 *  popover over the text. Narrow windows fall back to classic on their own. */
export type NoteStyle = "margin" | "classic";

export type ExtensionSettings = {
  /** Whether opening a covered page on this kind of site writes an anonymous
   *  visit row. The welcome page asks about exactly these. */
  saveVisits: Record<VisitSiteKind, boolean>;
  /** The "N Common Notes on this page" card on checked pages. */
  showNoteCountOverlay: boolean;
  /** The note-count badges on listing thumbnails. */
  showThumbnailBadges: boolean;
  noteStyle: NoteStyle;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  saveVisits: { substack: true, youtube: true, lesswrong: true },
  // Off by default since 2026-08-31 (Jim's call): the margin markers already
  // say there are notes, so the card is opt-in.
  showNoteCountOverlay: false,
  showThumbnailBadges: true,
  noteStyle: "margin",
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

// Whether the settings onboarding has run. Before the welcome page existed
// this was the consent gate: the background opened the settings page once so
// the user had seen the visit-recording checkboxes. It still marks "this
// install saw the tracking choice under the old flow", which is what lets the
// welcome backfill below skip existing users.
const SETTINGS_ONBOARDING_KEY = "cn:settingsOnboardingDone";

export async function getSettingsOnboardingDone(): Promise<boolean> {
  return ((await browser.storage.sync.get(SETTINGS_ONBOARDING_KEY))[SETTINGS_ONBOARDING_KEY] as boolean | undefined) ?? false;
}

// Whether the user has been through the welcome page, which is where the
// visit-recording question is asked. Visit recording stays inert until this
// is set (utils/linkVisits.ts), so nothing is recorded before the user made
// the choice. Seeing the settings page counts too, because the per-site
// checkboxes are the same choice in more detail.
const WELCOME_SEEN_KEY = "cn:welcomeSeen";

export async function getWelcomeSeen(): Promise<boolean> {
  return ((await browser.storage.sync.get(WELCOME_SEEN_KEY))[WELCOME_SEEN_KEY] as boolean | undefined) ?? false;
}

export async function markWelcomeSeen(): Promise<void> {
  await browser.storage.sync.set({ [WELCOME_SEEN_KEY]: true });
}
