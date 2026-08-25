import { describe, expect, mock, test } from "bun:test";

/* Covers the feed walker's scope-aware skip rule: an entry whose item is a
 * whole-page check is dropped, while a reader-note or paragraph item is kept
 * and carries the item so the walker can promote it. */

let knownItems: { id: string; url: string; checked_scope: "page" | "paragraph" | null }[] = [];

mock.module("./db", () => ({
  QUEUE_PRIORITY: { requested: 2, followed: 1, backlog: 0 },
  fetchItemUrlsIn: () => Promise.resolve(knownItems),
  fetchItemUrlsContaining: () => Promise.resolve(knownItems),
  fetchFollowedFeeds: () => Promise.resolve([]),
  fetchItemClaims: () => Promise.resolve([]),
  fetchOrphanedProcessingItems: () => Promise.resolve([]),
  enqueueItems: () => Promise.resolve(0),
  markItemError: () => Promise.resolve(),
  promoteItemToWholePage: () => Promise.resolve(),
  requeueItem: () => Promise.resolve(),
  resolveProjectId: () => Promise.resolve("project-id"),
}));

const { unprocessedEntries } = await import("./autoEnqueue");

const feed = { project: "test", type: "substack" as const, publicationUrl: "https://test.substack.com" };
const entry = (url: string) => ({ source: "substack" as const, url, matchKey: url, label: url });

describe("unprocessedEntries", () => {
  test("an entry with no item row is kept as a fresh enqueue", async () => {
    knownItems = [];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/new")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem).toBeNull();
  });

  test("a whole-page item drops its entry, whatever its status", async () => {
    knownItems = [{ id: "i1", url: "https://test.substack.com/p/old", checked_scope: "page" }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/old")]);
    expect(result).toHaveLength(0);
  });

  test("a reader-note item keeps its entry and carries the item for promotion", async () => {
    knownItems = [{ id: "i1", url: "https://test.substack.com/p/noted", checked_scope: null }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/noted")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem?.id).toBe("i1");
  });

  test("a paragraph-checked item keeps its entry too", async () => {
    knownItems = [{ id: "i1", url: "https://test.substack.com/p/partial", checked_scope: "paragraph" }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/partial")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem?.checked_scope).toBe("paragraph");
  });
});
