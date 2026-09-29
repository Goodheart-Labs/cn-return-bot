import { beforeEach, describe, expect, test } from "bun:test";
import { browser } from "#imports";
import { fakeBrowser } from "@webext-core/fake-browser";
import { DEFAULT_NOTE_DISPLAY, getNoteDisplay, getSettings, updateNoteDisplay, updateSettings } from "./settings";

const storedSync = async (key: string) => (await browser.storage.sync.get(key))[key];

beforeEach(() => fakeBrowser.reset());

describe("updateSettings", () => {
  test("stores only the keys the user changed, so later default changes still reach them", async () => {
    await updateSettings({ noteStyle: "classic" });
    await updateSettings({ saveVisits: { youtube: false } });
    expect(await storedSync("cn:settings")).toEqual({ noteStyle: "classic", saveVisits: { youtube: false } });
    const settings = await getSettings();
    expect(settings.noteStyle).toBe("classic");
    expect(settings.saveVisits).toEqual({ substack: true, youtube: false, lesswrong: true });
  });
});

describe("note display", () => {
  test("helpful notes are open, notes needing ratings collapsed and unhelpful ones a dot by default", async () => {
    expect(await getNoteDisplay()).toEqual({ helpful: "open", needs_ratings: "collapse", not_helpful: "dot" });
  });

  test("a stored choice that no longer exists falls back to the default", async () => {
    await browser.storage.sync.set({ "cn:noteDisplay": { helpful: "show", needs_ratings: "faint", not_helpful: "hide" } });
    expect(await getNoteDisplay()).toEqual({ helpful: "open", needs_ratings: "collapse", not_helpful: "hide" });
  });

  test("a change stores only the status it names", async () => {
    await updateNoteDisplay({ not_helpful: "hide" });
    expect(await storedSync("cn:noteDisplay")).toEqual({ not_helpful: "hide" });
    expect(await getNoteDisplay()).toEqual({ ...DEFAULT_NOTE_DISPLAY, not_helpful: "hide" });
  });
});
