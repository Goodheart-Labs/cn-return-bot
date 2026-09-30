import { browser } from "#imports";
import type { NoteStatus } from "@cn/core/noteScore";
import { DEFAULT_PILL_PALETTE, type PillPalette } from "@cn/features/notes/pillPalette";

// The pages the user has already asked us to cover with "Request notes on this
// page". Reopening the popup on such a page shows the done state instead of creating
// a second request. The list is a rolling window. Sync storage allows about 8KB per
// key, so we only remember the most recent requests.
//
// Each page is remembered with the time it was asked for, and only while the
// check could still be running. The memory exists to stop a double submission,
// not to record history: a check that failed has to be askable again, and a
// check that succeeded turns the page into one the popup shows notes for. The
// content script forgets a page as soon as its check ends, and this window is
// what covers the case where the tab was closed before that happened.
const REQUESTED_PAGES_KEY = "cn:requestedPages";
const REQUESTED_PAGES_MAX = 50;
const REQUESTED_PAGE_TTL_MS = 60 * 60_000;

/** Entries written before this became a timestamped map are read as expired.
 *  They are a local convenience, and every one of them is long finished. */
async function readRequestedPages(): Promise<Record<string, number>> {
  const stored = (await browser.storage.sync.get(REQUESTED_PAGES_KEY))[REQUESTED_PAGES_KEY];
  if (!stored || Array.isArray(stored)) return {};
  const cutoff = Date.now() - REQUESTED_PAGE_TTL_MS;
  return Object.fromEntries(Object.entries(stored as Record<string, number>).filter(([, at]) => at > cutoff));
}

export async function getRequestedPages(): Promise<string[]> {
  return Object.keys(await readRequestedPages());
}

export async function addRequestedPage(pageUrl: string): Promise<void> {
  const pages = Object.entries({ ...(await readRequestedPages()), [pageUrl]: Date.now() });
  await browser.storage.sync.set({ [REQUESTED_PAGES_KEY]: Object.fromEntries(pages.slice(-REQUESTED_PAGES_MAX)) });
}

/** Called when a page's check ends, however it ended. */
export async function forgetRequestedPage(pageUrl: string): Promise<void> {
  const pages = await readRequestedPages();
  delete pages[pageUrl];
  await browser.storage.sync.set({ [REQUESTED_PAGES_KEY]: pages });
}

// How the notes of each status appear on a page. The setting lives in sync
// storage, so it follows the user across devices. It replaced the two "show
// notes that need more ratings" and "show unhelpful notes" tickboxes on
// 2026-09-29 (GOO-239). Those were stored under "cn:noteFilters", which is no
// longer read, so every reader starts from the new defaults once.
const NOTE_DISPLAY_KEY = "cn:noteDisplay";

/** "open" puts the note's card on screen without a click: beside its passage
 *  in the margin, or over the video while playback is in the note's part.
 *  "collapse" draws the marker and tints the passage, and the card opens when
 *  the reader clicks either. "dot" draws only the marker, with no tint. "hide"
 *  leaves the note off the page. */
export type NoteDisplay = "open" | "collapse" | "dot" | "hide";
export type NoteDisplaySettings = Record<NoteStatus, NoteDisplay>;

const NOTE_DISPLAYS: readonly NoteDisplay[] = ["open", "collapse", "dot", "hide"];

// Jim's call on 2026-09-29: helpful notes are open, notes that need ratings
// wait for a click, and unhelpful notes only leave their dot.
export const DEFAULT_NOTE_DISPLAY: NoteDisplaySettings = { helpful: "open", needs_ratings: "collapse", not_helpful: "dot" };

/** A stored value that is not one of today's choices falls back to the
 *  default. Early test builds stored "show" and "faint" choices that no
 *  longer exist. */
export async function getNoteDisplay(): Promise<NoteDisplaySettings> {
  const stored = await readSyncObject<NoteDisplaySettings>(NOTE_DISPLAY_KEY);
  const valid = Object.entries(stored).filter(([, display]) => NOTE_DISPLAYS.includes(display));
  return { ...DEFAULT_NOTE_DISPLAY, ...Object.fromEntries(valid) };
}

export async function updateNoteDisplay(patch: Partial<NoteDisplaySettings>): Promise<void> {
  await patchSyncObject(NOTE_DISPLAY_KEY, patch);
}

/** Reads an object this module keeps in sync storage, or an empty one. */
async function readSyncObject<T extends object>(key: string): Promise<Partial<T>> {
  return ((await browser.storage.sync.get(key))[key] as Partial<T> | undefined) ?? {};
}

/** Stores only the keys the user actually changed. Unchanged keys stay
 *  absent from storage, so a later change of their default reaches this user
 *  too. Writing the merged object instead is what kept the old note-count
 *  card on for everyone who had saved any setting before its default
 *  flipped. */
async function patchSyncObject(key: string, patch: object): Promise<void> {
  await browser.storage.sync.set({ [key]: { ...(await readSyncObject(key)), ...patch } });
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

export const onNoteDisplayChanged = (callback: () => void) => onSyncKeyChanged(NOTE_DISPLAY_KEY, callback);

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
  /** How the rating pills are coloured, see features/notes/pillPalette.ts. */
  pillPalette: PillPalette;
  /** Whether opening a covered page on this kind of site writes an anonymous
   *  visit row. The welcome page asks about exactly these. */
  saveVisits: Record<VisitSiteKind, boolean>;
  /** The note-count badges on listing thumbnails. */
  showThumbnailBadges: boolean;
  noteStyle: NoteStyle;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  saveVisits: { substack: true, youtube: true, lesswrong: true },
  showThumbnailBadges: true,
  noteStyle: "margin",
  pillPalette: DEFAULT_PILL_PALETTE,
};

export type SettingsPatch = Partial<Omit<ExtensionSettings, "saveVisits">> & {
  saveVisits?: Partial<Record<VisitSiteKind, boolean>>;
};

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await readSyncObject<SettingsPatch>(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    saveVisits: { ...DEFAULT_SETTINGS.saveVisits, ...stored.saveVisits },
  };
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const stored = await readSyncObject<SettingsPatch>(SETTINGS_KEY);
  await patchSyncObject(SETTINGS_KEY, { ...patch, saveVisits: { ...stored.saveVisits, ...patch.saveVisits } });
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
