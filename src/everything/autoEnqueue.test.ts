import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the feed walker's scope-aware skip rule: an entry whose item is a
 * whole-page check is dropped, while a reader-note or paragraph item is kept
 * and carries the item so the walker can promote it. */

mock.module("./db", dbMock);

beforeEach(resetDbState);

const { unprocessedEntries, rankCandidates } = await import("./autoEnqueue");

const feed = { project: "test", type: "substack" as const, publicationUrl: "https://test.substack.com" };
const entry = (url: string) => ({ source: "substack" as const, url, matchKey: url, label: url });

describe("unprocessedEntries", () => {
  test("an entry with no item row is kept as a fresh enqueue", async () => {
    dbState.knownItems = [];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/new")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem).toBeNull();
  });

  test("a whole-page item drops its entry, whatever its status", async () => {
    dbState.knownItems = [{ id: "i1", url: "https://test.substack.com/p/old", checked_scope: "page" }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/old")]);
    expect(result).toHaveLength(0);
  });

  test("a reader-note item keeps its entry and carries the item for promotion", async () => {
    dbState.knownItems = [{ id: "i1", url: "https://test.substack.com/p/noted", checked_scope: null }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/noted")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem?.id).toBe("i1");
  });

  test("a paragraph-checked item keeps its entry too", async () => {
    dbState.knownItems = [{ id: "i1", url: "https://test.substack.com/p/partial", checked_scope: "paragraph" }];
    const result = await unprocessedEntries(feed, [entry("https://test.substack.com/p/partial")]);
    expect(result).toHaveLength(1);
    expect(result[0]!.existingItem?.checked_scope).toBe("paragraph");
  });
});

/* Covers the cross-feed ordering: candidates are served by the average of a
 * recency rank and an author-priority rank, so a top author's backlog and a
 * lower author's fresh post take turns. */
describe("rankCandidates", () => {
  const c = (name: string, feedIndex: number, publishedAt?: string) => ({ name, feedIndex, publishedAt });
  const names = (candidates: { name: string }[]) => candidates.map((x) => x.name);

  test("a tied average goes to the more recent post", () => {
    // Top author's old post: recency rank 1, author rank 0. Lower author's new
    // post: recency rank 0, author rank 1. Equal averages, recency decides.
    const ranked = rankCandidates([c("top-old", 0, "2026-08-01"), c("low-new", 1, "2026-08-30")]);
    expect(names(ranked)).toEqual(["low-new", "top-old"]);
  });

  test("the top author's fresh post beats everything", () => {
    const ranked = rankCandidates([
      c("low-new", 2, "2026-08-30"),
      c("top-fresh", 0, "2026-08-31"),
      c("mid-old", 1, "2026-08-01"),
    ]);
    expect(names(ranked)[0]).toBe("top-fresh");
  });

  test("a lower author's much newer post outranks a top author's stale backlog", () => {
    const ranked = rankCandidates([
      c("top-stale-1", 0, "2023-01-01"),
      c("top-stale-2", 0, "2023-01-02"),
      c("low-new", 3, "2026-08-30"),
    ]);
    // Recency ranks: low-new 0, stale-2 1, stale-1 2. Author ranks: stale-2 0,
    // stale-1 1, low-new 2. Averages: stale-2 0.5, low-new 1, stale-1 1.5.
    expect(names(ranked)).toEqual(["top-stale-2", "low-new", "top-stale-1"]);
  });

  test("an unknown date sorts newest, like the queue's own ordering", () => {
    const ranked = rankCandidates([c("dated", 0, "2026-08-30"), c("undated", 1)]);
    expect(names(ranked)[0]).toBe("undated");
  });
});
