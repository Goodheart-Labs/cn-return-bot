import { afterEach, beforeEach, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import { getSwitches, parseSwitches, syncSwitches } from "./switches";

const realFetch = globalThis.fetch;
const serve = (response: Response) => { globalThis.fetch = (async () => response) as unknown as typeof fetch; };
beforeEach(() => fakeBrowser.reset());
afterEach(() => { globalThis.fetch = realFetch; });

test("a browser that never synced has the pill off; a sync turns it on; a failed read keeps the answer", async () => {
  expect((await getSwitches()).notesAheadPill).toBe(false);
  serve(Response.json({ notesAheadPill: true }));
  await syncSwitches();
  expect((await getSwitches()).notesAheadPill).toBe(true);
  serve(new Response("down", { status: 503 }));
  await syncSwitches();
  expect((await getSwitches()).notesAheadPill).toBe(true);
  serve(Response.json({ notesAheadPill: false }));
  await syncSwitches();
  expect((await getSwitches()).notesAheadPill).toBe(false);
});

test("a switch is on only when the file says exactly true", () => {
  expect(parseSwitches({ notesAheadPill: true }).notesAheadPill).toBe(true);
  expect(parseSwitches({ notesAheadPill: false }).notesAheadPill).toBe(false);
  // Never synced, an error page parsed as something else, or a wrong type: off.
  for (const bad of [undefined, null, {}, [], "true", { notesAheadPill: "true" }, { notesAheadPill: 1 }]) {
    expect(parseSwitches(bad).notesAheadPill).toBe(false);
  }
});

test("the file the site serves parses, and ships with the pill off", async () => {
  const file = await Bun.file(new URL("../../everything-web/public/extension-switches.json", import.meta.url)).json();
  expect(file).toEqual({ notesAheadPill: false });
});
