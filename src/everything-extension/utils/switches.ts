import { browser } from "#imports";
import { COMMONNOTES_ORIGIN } from "@cn/core/pageUrls";

/* Display switches we can flip from the server, without a store release. The
 * background's hourly sync reads a small JSON file from commonnotes.net
 * (src/everything-web/public/extension-switches.json; data, not code) and
 * caches it; the page reads the cache. A switch is on only when the file says
 * exactly `true`, so a browser that never reached the file, or reached
 * something else, shows what the store build showed before the switch existed. */
const SWITCHES_URL = `${COMMONNOTES_ORIGIN}/extension-switches.json`;
const SWITCHES_KEY = "cn:switches";

export interface Switches {
  /** The "N notes on this page ↓" pill (components/NotesAheadPill.tsx). */
  notesAheadPill: boolean;
}

export function parseSwitches(value: unknown): Switches {
  const file = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return { notesAheadPill: file.notesAheadPill === true };
}

/** Run by the background sync. A failed read keeps the last answer. */
export async function syncSwitches(): Promise<void> {
  const response = await fetch(SWITCHES_URL, { cache: "no-store" });
  if (!response.ok) return;
  await browser.storage.local.set({ [SWITCHES_KEY]: parseSwitches(await response.json()) });
}

export async function getSwitches(): Promise<Switches> {
  return parseSwitches((await browser.storage.local.get(SWITCHES_KEY))[SWITCHES_KEY]);
}
