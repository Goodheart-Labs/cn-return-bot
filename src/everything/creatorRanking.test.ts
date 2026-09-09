import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the two-source rule (GOO-107) and the two counting rules (GOO-135).
 * A creator is walked because their priority window is open, or because readers
 * read them, and for no other reason. Priority beats attention, attention
 * orders everyone else, and a creator we already know keeps their project even
 * when they qualify on attention alone.
 *
 * Which counting rule applies is decided by the two-reader proof: until some
 * creator has been visited by two different readers, the walk counts visit rows
 * exactly as it did before, and after that it counts people. */

mock.module("./db", dbMock);

beforeEach(resetDbState);

const { rankCreators } = await import("./creatorRanking");

const DAY_MS = 24 * 3600_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

const creator = (slug: string, overrides: Partial<(typeof dbState.creatorProjects)[number]> = {}) => ({
  project_slug: slug,
  feed_url: `https://${slug}.substack.com`,
  priority_until: null,
  top_posts_refreshed_at: null,
  ...overrides,
});

/** One creator's attention row. `visits` defaults to something that satisfies
 *  the old rule, so a test that is about readers does not have to think about
 *  visits and the other way round. */
const read = (
  feedUrl: string,
  counts: { visits?: number; pages?: number; readers?: number; regulars?: number } = {},
) => ({
  feed_url: feedUrl,
  visits: counts.visits ?? 2,
  pages: counts.pages ?? 0,
  readers: counts.readers ?? 0,
  regular_readers: counts.regulars ?? 0,
});

const rankedSlugs = async () => (await rankCreators()).creators.map((c) => c.project_slug);

describe("rankCreators, before any creator has had two different readers", () => {
  // The reader hash arrived with GOO-135, so every row written before it has
  // none. Until the proof arrives the walk therefore counts rows, exactly as it
  // did before, and nothing goes quiet on the day the change ships.

  test("the run says which rule it used", async () => {
    expect((await rankCreators()).rule).toBe("visits");
  });

  test("two visit rows are enough even with no readers at all", async () => {
    dbState.creatorAttention = [read("https://oneclick.substack.com", { visits: 1 })];
    expect(await rankedSlugs()).toEqual([]);
    dbState.creatorAttention = [read("https://oneclick.substack.com", { visits: 2 })];
    expect(await rankedSlugs()).toEqual(["oneclick"]);
  });

  test("creators order by visit rows, most first", async () => {
    dbState.creatorAttention = [
      read("https://few.substack.com", { visits: 2 }),
      read("https://many.substack.com", { visits: 9 }),
    ];
    expect(await rankedSlugs()).toEqual(["many", "few"]);
  });
});

describe("rankCreators, once two different readers have been seen", () => {
  beforeEach(() => {
    dbState.twoReadersSeen = true;
  });

  test("the run says which rule it used", async () => {
    expect((await rankCreators()).rule).toBe("readers");
  });

  test("one regular reader is enough, and visit rows on their own are not", async () => {
    dbState.creatorAttention = [
      read("https://reloaded.substack.com", { visits: 9, pages: 1, readers: 1, regulars: 0 }),
      read("https://read.substack.com", { visits: 2, pages: 2, readers: 1, regulars: 1 }),
    ];
    expect(await rankedSlugs()).toEqual(["read"]);
  });

  test("rows with no reader behind them stop counting", async () => {
    // An old row, or one from an extension copy that never updated, raises the
    // visit number and nothing else. Under this rule it buys no walk.
    dbState.creatorAttention = [read("https://old.substack.com", { visits: 40 })];
    expect(await rankedSlugs()).toEqual([]);
  });

  test("creators order by regular readers, most first", async () => {
    dbState.creatorAttention = [
      read("https://one.substack.com", { pages: 9, regulars: 1 }),
      read("https://three.substack.com", { pages: 6, regulars: 3 }),
    ];
    expect(await rankedSlugs()).toEqual(["three", "one"]);
  });

  test("creators with the same readers order by how many different pages were opened", async () => {
    // Today almost every creator has exactly one regular reader, so this is the
    // ordering in practice. It ignores reloads, which the visit count did not.
    dbState.creatorAttention = [
      read("https://shallow.substack.com", { visits: 50, pages: 2, regulars: 1 }),
      read("https://deep.substack.com", { visits: 8, pages: 7, regulars: 1 }),
    ];
    expect(await rankedSlugs()).toEqual(["deep", "shallow"]);
  });

  test("the order is stable when everything ties", async () => {
    dbState.creatorAttention = [
      read("https://bbb.substack.com", { pages: 3, regulars: 1 }),
      read("https://aaa.substack.com", { pages: 3, regulars: 1 }),
    ];
    expect(await rankedSlugs()).toEqual(["aaa", "bbb"]);
  });
});

describe("rankCreators, priority and projects", () => {
  test("a creator with neither priority nor attention is not walked at all", async () => {
    dbState.creatorProjects = [creator("zvi"), creator("acx")];
    expect(await rankedSlugs()).toEqual([]);
  });

  test("an open priority window walks a creator nobody has read", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(3) }), creator("acx")];
    expect(await rankedSlugs()).toEqual(["zvi"]);
  });

  test("an expired window does not, and does not beat a read creator", async () => {
    dbState.creatorProjects = [creator("expired", { priority_until: inDays(-1) }), creator("popular")];
    dbState.creatorAttention = [read("https://popular.substack.com", { visits: 5 })];
    expect(await rankedSlugs()).toEqual(["popular"]);
  });

  test("priority beats any amount of attention", async () => {
    dbState.twoReadersSeen = true;
    dbState.creatorProjects = [creator("popular"), creator("pressed", { priority_until: inDays(3) })];
    dbState.creatorAttention = [read("https://popular.substack.com", { pages: 20, readers: 9, regulars: 9 })];
    expect(await rankedSlugs()).toEqual(["pressed", "popular"]);
  });

  test("a creator we know keeps their project when they qualify on attention alone", async () => {
    // A project's slug can carry a collision suffix, so deriving it from the
    // URL would say "thezvi", miss the real project, create a second one and
    // split the creator's notes on the public site. The URL is the key.
    dbState.creatorProjects = [{ ...creator("thezvi-2"), feed_url: "https://thezvi.substack.com" }];
    dbState.creatorAttention = [read("https://thezvi.substack.com", { visits: 4 })];
    const { creators } = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["thezvi-2"]);
    expect(creators[0]!.prioritized).toBe(false);
  });

  test("a creator we know keeps their top-posts stamp when walked on attention", async () => {
    // Without this the stamp reads as null, the creator looks permanently
    // overdue, and the walk re-fetches their top posts on every single run.
    const stamp = inDays(-1);
    dbState.creatorProjects = [creator("zvi", { top_posts_refreshed_at: stamp })];
    dbState.creatorAttention = [read("https://zvi.substack.com", { visits: 4 })];
    expect((await rankCreators()).creators[0]!.top_posts_refreshed_at).toBe(stamp);
  });

  test("a creator we have never seen is walked under a slug derived from the url", async () => {
    dbState.creatorAttention = [read("https://www.youtube.com/@SomeChannel", { visits: 4 })];
    const { creators } = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["somechannel"]);
    expect(creators[0]!.top_posts_refreshed_at).toBeNull();
  });

  test("a trailing slash or different casing still matches a creator we know", async () => {
    dbState.creatorProjects = [creator("acx")];
    dbState.creatorAttention = [read("https://ACX.substack.com/", { visits: 3 })];
    const { creators } = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["acx"]);
    expect(creators[0]!.visits).toBe(3);
  });

  test("a prioritized creator carries their own numbers too", async () => {
    dbState.twoReadersSeen = true;
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(2) })];
    dbState.creatorAttention = [read("https://zvi.substack.com", { visits: 6, pages: 4, readers: 2, regulars: 1 })];
    const zvi = (await rankCreators()).creators[0]!;
    expect(zvi.visits).toBe(6);
    expect(zvi.readers).toBe(2);
    expect(zvi.regularReaders).toBe(1);
  });

  test("a read feed URL of no known shape is skipped", async () => {
    dbState.creatorAttention = [read("https://example.com/some-blog", { visits: 7 })];
    expect(await rankedSlugs()).toEqual([]);
  });
});
