import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the feed walker's scope-aware skip rule: an entry whose item is a
 * whole-page check is dropped, while a reader-note or paragraph item is kept
 * and carries the item so the walker can promote it. */

mock.module("./db", dbMock);

beforeEach(resetDbState);

const { unprocessedEntries, rankCandidates, topPostEntries } = await import("./autoEnqueue");

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

/* Covers the all-time top posts (GOO-81): in the author rank they line up
 * behind the creator's recent posts, and in the recency rank they carry their
 * real old dates, so the blend keeps them at the back of the ordering. */
describe("rankCandidates with top posts", () => {
  const c = (name: string, feedIndex: number, publishedAt?: string, topPopularity?: number) => ({
    name,
    feedIndex,
    publishedAt,
    topPopularity,
  });
  const names = (candidates: { name: string }[]) => candidates.map((x) => x.name);

  test("every fresh post outranks every top post, even a top post with huge popularity", () => {
    const ranked = rankCandidates([
      c("fresh-a", 0, "2026-08-30"),
      c("top-hit", 0, "2019-05-01", 5_000_000),
      c("fresh-b", 1, "2026-08-31"),
    ]);
    // Both ranks put the top post last: the author rank because tops come
    // after the same feed's recent posts, the recency rank because 2019 is old.
    expect(names(ranked)).toEqual(["fresh-a", "fresh-b", "top-hit"]);
  });

  test("a feed's top posts sort behind both feeds' fresh posts", () => {
    const ranked = rankCandidates([
      c("fresh-0", 0, "2026-08-30"),
      c("top-liked", 0, "2020-01-01", 500),
      c("top-newer", 0, "2023-01-01", 100),
      c("fresh-1", 1, "2026-08-31"),
    ]);
    // The two tops tie on the blended score. Recency breaks the tie, so the
    // newer top post goes first despite fewer likes. Popularity only decides
    // between tops whose dates do not already separate them.
    expect(names(ranked)).toEqual(["fresh-0", "fresh-1", "top-newer", "top-liked"]);
  });

  test("equal-date top posts keep their popularity order", () => {
    const ranked = rankCandidates([
      c("fresh", 0, "2026-08-30"),
      c("top-500", 0, "2020-01-01", 500),
      c("top-100", 0, "2020-01-01", 100),
    ]);
    expect(names(ranked)).toEqual(["fresh", "top-500", "top-100"]);
  });
});

/* Covers turning cached top posts into feed entries. */
describe("topPostEntries", () => {
  const row = (url: string, source: "substack" | "youtube", rank: number) => ({
    feed_url: "https://feed",
    source,
    url,
    title: "T",
    published_at: "2020-01-01T12:00:00Z",
    popularity: 1000,
    rank,
  });

  test("a YouTube top post matches items by its video id", () => {
    const entries = topPostEntries([row("https://www.youtube.com/watch?v=abc123XYZ_-", "youtube", 1)], []);
    expect(entries[0]!.matchKey).toBe("abc123XYZ_-");
    expect(entries[0]!.topPopularity).toBe(1000);
    expect(entries[0]!.publishedAt).toBe("2020-01-01");
  });

  test("a top post already among the recent entries is dropped", () => {
    const recent = [{ source: "substack" as const, url: "https://s/p/viral", matchKey: "https://s/p/viral", label: "x" }];
    const entries = topPostEntries([row("https://s/p/viral", "substack", 1), row("https://s/p/old", "substack", 2)], recent);
    expect(entries.map((e) => e.url)).toEqual(["https://s/p/old"]);
  });
});
