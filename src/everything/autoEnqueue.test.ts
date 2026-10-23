import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the feed walker's scope-aware skip rule: an entry whose item is a
 * whole-page check is dropped, while a reader-note or paragraph item is kept
 * and carries the item so the walker can promote it. */

mock.module("./db", dbMock);

beforeEach(resetDbState);

const { unprocessedEntries, topPostEntries, walkToFirstCandidate, orderCandidates } = await import("./autoEnqueue");

const feed = { project: "test", type: "substack" as const, url: "https://test.substack.com" };
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

  test("a list cached when it held 5 posts offers only the top 3", () => {
    const tops = [1, 2, 3, 4, 5].map((rank) => row(`https://s/p/top-${rank}`, "substack", rank));
    expect(topPostEntries(tops, []).map((e) => e.url)).toEqual(["https://s/p/top-1", "https://s/p/top-2", "https://s/p/top-3"]);
  });

  test("a top post already among the recent entries is dropped", () => {
    const recent = [{ source: "substack" as const, url: "https://s/p/viral", matchKey: "https://s/p/viral", label: "x" }];
    const entries = topPostEntries([row("https://s/p/viral", "substack", 1), row("https://s/p/old", "substack", 2)], recent);
    expect(entries.map((e) => e.url)).toEqual(["https://s/p/old"]);
  });
});

/* Covers the walk itself: go down the ranking from the top and stop at the
 * first creator with anything unchecked. A creator that cannot be listed is
 * passed over and counted separately. */
describe("walkToFirstCandidate", () => {
  const creator = (name: string, unchecked: number | null) => ({ name, unchecked });
  /** The injected walk: answers each creator's candidates, or null for a
   *  creator whose feed will not list, and records who was asked. */
  const walker = () => {
    const asked: string[] = [];
    const walk = async (c: { name: string; unchecked: number | null }) => {
      asked.push(c.name);
      return c.unchecked === null ? null : { candidates: Array.from({ length: c.unchecked }, (_, i) => `${c.name}-${i}`) };
    };
    return { asked, walk };
  };

  test("the walk stops at the first creator with something unchecked, and nobody below is asked", async () => {
    const { asked, walk } = walker();
    const result = await walkToFirstCandidate([creator("a", 0), creator("b", 0), creator("c", 2), creator("d", 5)], walk);
    expect(asked).toEqual(["a", "b", "c"]);
    expect(result.found?.creator.name).toBe("c");
    expect(result.found?.index).toBe(2);
    expect(result.found?.walk.candidates[0]).toBe("c-0");
    expect(result.walked.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  test("when everyone is caught up the whole ranking is walked and nothing is found", async () => {
    const { asked, walk } = walker();
    const result = await walkToFirstCandidate([creator("a", 0), creator("b", 0)], walk);
    expect(asked).toEqual(["a", "b"]);
    expect(result.found).toBeNull();
  });

  test("a creator whose feed will not list is passed over and counted", async () => {
    const { walk } = walker();
    const result = await walkToFirstCandidate([creator("dead", null), creator("b", 1)], walk);
    expect(result.unlisted).toBe(1);
    expect(result.walked.map((c) => c.name)).toEqual(["b"]);
    expect(result.found?.creator.name).toBe("b");
  });
});

/* Covers the order the walk takes one creator's posts in. */
describe("orderCandidates", () => {
  const recent = (url: string, publishedAt: string) => ({ ...entry(url), publishedAt, existingItem: null });
  const top = (url: string) => ({ ...entry(url), topPopularity: 100, existingItem: null });
  const failed = (url: string, published_at: string) =>
    ({ id: url, url, title: null, published_at, retries: 0, priority: 0, feed_url: "https://test.substack.com" });
  const urls = (candidates: ReturnType<typeof orderCandidates>) =>
    candidates.map((c) => (c.kind === "unchecked" ? c.entry.url : c.item.url));

  test("a failed post is mixed in with the recent posts by publish date, and top posts come last", () => {
    const result = orderCandidates(
      [recent("new", "2026-10-19"), top("top"), recent("older", "2026-10-10")],
      [failed("failed", "2026-10-17T08:00:00+00:00")],
    );
    expect(urls(result)).toEqual(["new", "failed", "older", "top"]);
    expect(result[1]!.kind).toBe("retry");
  });

  test("a creator with only a failed post still has a candidate", () => {
    expect(urls(orderCandidates([], [failed("failed", "2026-10-17")]))).toEqual(["failed"]);
  });
});
