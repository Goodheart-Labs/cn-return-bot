import { expect, test } from "bun:test";
import { DELTA_OVERLAP_MS, FULL_SYNC_EVERY_MS, mergeCoveredUrls, parseSyncState, planSync } from "./notedSitesSync";

const now = Date.parse("2026-11-08T23:00:00Z");

test("a first sync, or one without a cached list, downloads everything", () => {
  expect(planSync(null, true, now)).toEqual({ kind: "full" });
  expect(planSync({ fullAt: now - 60_000, lastAt: now - 60_000 }, false, now)).toEqual({ kind: "full" });
});

test("within the hour a sync asks only for pages since the last sync, with overlap", () => {
  const lastAt = now - 5 * 60_000;
  expect(planSync({ fullAt: now - 30 * 60_000, lastAt }, true, now)).toEqual({ kind: "delta", since: new Date(lastAt - DELTA_OVERLAP_MS).toISOString() });
});

test("an hour after the last full sync, or after the clock went backwards, it downloads everything", () => {
  expect(planSync({ fullAt: now - FULL_SYNC_EVERY_MS, lastAt: now - 60_000 }, true, now)).toEqual({ kind: "full" });
  expect(planSync({ fullAt: now + 60_000, lastAt: now + 60_000 }, true, now)).toEqual({ kind: "full" });
});

test("a stored state that is not two numbers is no state", () => {
  expect(parseSyncState(undefined)).toBeNull();
  expect(parseSyncState({ fullAt: "x", lastAt: 1 })).toBeNull();
  expect(parseSyncState({ fullAt: 1, lastAt: 2 })).toEqual({ fullAt: 1, lastAt: 2 });
});

test("merging adds only new URLs, once, and reports nothing new as null", () => {
  expect(mergeCoveredUrls(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
  expect(mergeCoveredUrls(["a"], ["a"])).toBeNull();
  expect(mergeCoveredUrls(["a"], [])).toBeNull();
});
