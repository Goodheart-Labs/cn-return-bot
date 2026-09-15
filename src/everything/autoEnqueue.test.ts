import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the feed walker's scope-aware skip rule: an entry whose item is a
 * whole-page check is dropped, while a reader-note or paragraph item is kept
 * and carries the item so the walker can promote it. */

mock.module("./db", dbMock);

beforeEach(resetDbState);

const { unprocessedEntries, rankCandidates, topPostEntries, publishingRatePerDay, admitCreators } = await import("./autoEnqueue");

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

/* Covers the cross-feed ordering: candidates are served by a weighted blend
 * of an author-priority rank (nine tenths) and a recency rank (one tenth), so
 * the most-read creators come first and a fresh post needs a nine-candidate
 * recency lead to make up for one step down the walk order. */
describe("rankCandidates", () => {
  const c = (name: string, feedIndex: number, publishedAt?: string) => ({ name, feedIndex, publishedAt });
  const names = (candidates: { name: string }[]) => candidates.map((x) => x.name);
  /* One post each from creators further down the walk order, every one newer
   * than the top author's old post and older than the second author's fresh
   * one, so they pad the recency gap between those two without ever ranking
   * ahead of either. */
  const fillers = (count: number) =>
    Array.from({ length: count }, (_, i) => c(`filler-${i}`, 2 + i, `2026-08-${String(10 + i).padStart(2, "0")}`));

  test("the top author's older post beats a lower author's newer post", () => {
    // Top author's old post: author rank 0, recency rank 1, score 0.1. Lower
    // author's new post: author rank 1, recency rank 0, score 0.9.
    const ranked = rankCandidates([c("top-old", 0, "2026-08-01"), c("low-new", 1, "2026-08-30")]);
    expect(names(ranked)).toEqual(["top-old", "low-new"]);
  });

  test("a tied score goes to the more recent post", () => {
    // The top author's post is nine recency steps behind the second author's
    // fresh post, which exactly pays for the one author step: both score 0.9.
    const ranked = rankCandidates([c("top-old", 0, "2026-08-01"), c("second-new", 1, "2026-08-30"), ...fillers(8)]);
    expect(names(ranked).slice(0, 2)).toEqual(["second-new", "top-old"]);
  });

  test("a recency lead of more than nine candidates outranks one author step", () => {
    // top-old: author 0, recency 10, score 1.0. second-new: author 1, recency 0, score 0.9.
    const ranked = rankCandidates([c("top-old", 0, "2026-08-01"), c("second-new", 1, "2026-08-30"), ...fillers(9)]);
    expect(names(ranked).slice(0, 2)).toEqual(["second-new", "top-old"]);
  });

  test("the top author's fresh post beats everything", () => {
    const ranked = rankCandidates([
      c("low-new", 2, "2026-08-30"),
      c("top-fresh", 0, "2026-08-31"),
      c("mid-old", 1, "2026-08-01"),
    ]);
    expect(names(ranked)[0]).toBe("top-fresh");
  });

  test("a top author's whole backlog is served before a lower author's newer post", () => {
    const ranked = rankCandidates([
      c("top-stale-1", 0, "2023-01-01"),
      c("top-stale-2", 0, "2023-01-02"),
      c("low-new", 3, "2026-08-30"),
    ]);
    // Recency ranks: low-new 0, stale-2 1, stale-1 2. Author ranks: stale-2 0,
    // stale-1 1, low-new 2. Scores: stale-2 0.1, stale-1 1.1, low-new 1.8.
    // The candidate window caps how long such a backlog can be.
    expect(names(ranked)).toEqual(["top-stale-2", "top-stale-1", "low-new"]);
  });

  test("an unknown date counts as newest, like the queue's own ordering", () => {
    // Same creator, so only recency separates the two, in both orderings.
    const ranked = rankCandidates([c("dated", 0, "2026-08-30"), c("undated", 0)]);
    expect(names(ranked)[0]).toBe("undated");
  });
});

/* Covers the all-time top posts (GOO-81): in the author rank they line up
 * behind the creator's recent posts, and in the recency rank they carry their
 * real old dates. Because the author rank dominates, a creator's top posts
 * follow that creator's own recent posts and come before lower creators. */
describe("rankCandidates with top posts", () => {
  const c = (name: string, feedIndex: number, publishedAt?: string, topPopularity?: number) => ({
    name,
    feedIndex,
    publishedAt,
    topPopularity,
  });
  const names = (candidates: { name: string }[]) => candidates.map((x) => x.name);

  test("a creator's top post follows their fresh post and precedes a lower creator's fresh post", () => {
    const ranked = rankCandidates([
      c("fresh-a", 0, "2026-08-30"),
      c("top-hit", 0, "2019-05-01", 5_000_000),
      c("fresh-b", 1, "2026-08-31"),
    ]);
    // Author ranks: fresh-a 0, top-hit 1, fresh-b 2. Recency ranks: fresh-b 0,
    // fresh-a 1, top-hit 2. Scores: fresh-a 0.1, top-hit 1.1, fresh-b 1.8.
    expect(names(ranked)).toEqual(["fresh-a", "top-hit", "fresh-b"]);
  });

  test("a feed's top posts sort behind both feeds' fresh posts", () => {
    const ranked = rankCandidates([
      c("fresh-0", 0, "2026-08-30"),
      c("top-liked", 0, "2020-01-01", 500),
      c("top-newer", 0, "2023-01-01", 100),
      c("fresh-1", 1, "2026-08-31"),
    ]);
    // Author ranks: fresh-0 0, top-liked 1, top-newer 2, fresh-1 3. Recency
    // ranks: fresh-1 0, fresh-0 1, top-newer 2, top-liked 3. Scores: fresh-0
    // 0.1, top-liked 1.2, top-newer 2.0, fresh-1 2.7. The popularity order
    // between the two tops holds because the author rank dominates.
    expect(names(ranked)).toEqual(["fresh-0", "top-liked", "top-newer", "fresh-1"]);
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

/* Covers the publishing rate: dated entries inside the last 14 days, divided
 * by 14. Undated entries do not count. */
describe("publishingRatePerDay", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const dated = (...days: string[]) => days.map((publishedAt) => ({ publishedAt }));

  test("seven posts in the window is half a post a day", () => {
    const entries = dated("2026-09-15", "2026-09-13", "2026-09-11", "2026-09-09", "2026-09-07", "2026-09-05", "2026-09-03");
    expect(publishingRatePerDay(entries, now)).toBeCloseTo(0.5, 5);
  });

  test("posts older than the window and undated posts do not count", () => {
    const entries = [...dated("2026-09-14", "2026-08-01", "2025-01-01"), { publishedAt: undefined }];
    expect(publishingRatePerDay(entries, now)).toBeCloseTo(1 / 14, 5);
  });

  test("the window edge is inclusive on the day", () => {
    expect(publishingRatePerDay(dated("2026-09-01"), now)).toBeCloseTo(1 / 14, 5);
    expect(publishingRatePerDay(dated("2026-08-31"), now)).toBe(0);
  });

  test("an empty listing is a rate of zero", () => {
    expect(publishingRatePerDay([], now)).toBe(0);
  });
});

/* Covers the budget-driven admission: creators are walked from the top until
 * their rates add up to the affordable posts a day, the crossing creator is
 * still walked, priority creators are always walked and counted first, and a
 * creator that cannot be listed is skipped without counting. */
describe("admitCreators", () => {
  const creator = (name: string, rate: number | null, prioritized = false, newPosts?: number) => ({ name, rate, prioritized, newPosts });
  /** The injected walk: answers each creator's own rate, or null for a
   *  creator whose feed will not list, and records who was walked. */
  const walker = () => {
    const walked: string[] = [];
    const walk = async (c: { name: string; rate: number | null; newPosts?: number }) => {
      walked.push(c.name);
      return c.rate === null ? null : { rate: c.rate, newPosts: c.newPosts ?? 1 };
    };
    return { walked, walk };
  };

  test("creators are walked in order until their rates fill the budget, and the crossing creator is still walked", async () => {
    const { walked, walk } = walker();
    const ranked = [creator("a", 1), creator("b", 1), creator("c", 1), creator("d", 1)];
    const result = await admitCreators(ranked, 2.5, walk);
    expect(walked).toEqual(["a", "b", "c"]);
    expect(result.admitted.map((x) => x.creator.name)).toEqual(["a", "b", "c"]);
    expect(result.cumulativeRate).toBe(3);
    expect(result.cutoffIndex).toBe(3);
  });

  test("nobody below the line is even listed", async () => {
    const { walked, walk } = walker();
    await admitCreators([creator("a", 5), creator("b", 1)], 2, walk);
    expect(walked).toEqual(["a"]);
  });

  test("when every creator fits there is no cutoff", async () => {
    const { walk } = walker();
    const result = await admitCreators([creator("a", 0.5), creator("b", 0.5)], 10, walk);
    expect(result.admitted).toHaveLength(2);
    expect(result.cutoffIndex).toBeNull();
  });

  test("a creator holding priority is always walked, even past the line, and counts first", async () => {
    const { walked, walk } = walker();
    const ranked = [creator("pressed-1", 2, true), creator("pressed-2", 2, true), creator("read", 1)];
    const result = await admitCreators(ranked, 1, walk);
    expect(walked).toEqual(["pressed-1", "pressed-2"]);
    expect(result.cumulativeRate).toBe(4);
    expect(result.cutoffIndex).toBe(2);
  });

  test("the walk stops once enough creators with posts to process were found, however cheap the day", async () => {
    const { walked, walk } = walker();
    const ranked = Array.from({ length: 6 }, (_, i) => creator(`c${i}`, 0.1));
    const result = await admitCreators(ranked, 1000, walk, 3);
    expect(walked).toEqual(["c0", "c1", "c2"]);
    expect(result.cutoff).toBe("enough");
    expect(result.cutoffIndex).toBe(3);
  });

  test("a creator with nothing new to process does not count towards that stop", async () => {
    const { walked, walk } = walker();
    const ranked = [creator("empty-1", 0.1, false, 0), creator("a", 0.1), creator("empty-2", 0.1, false, 0), creator("b", 0.1), creator("c", 0.1)];
    const result = await admitCreators(ranked, 1000, walk, 2);
    expect(walked).toEqual(["empty-1", "a", "empty-2", "b"]);
    expect(result.cutoff).toBe("enough");
  });

  test("the budget line is reported as such", async () => {
    const { walk } = walker();
    expect((await admitCreators([creator("a", 5), creator("b", 1)], 2, walk)).cutoff).toBe("budget");
  });

  test("a creator whose feed will not list is skipped and does not count", async () => {
    const { walked, walk } = walker();
    const result = await admitCreators([creator("dead", null), creator("b", 1), creator("c", 1)], 1, walk);
    expect(walked).toEqual(["dead", "b"]);
    expect(result.admitted.map((x) => x.creator.name)).toEqual(["b"]);
    expect(result.cumulativeRate).toBe(1);
  });
});
