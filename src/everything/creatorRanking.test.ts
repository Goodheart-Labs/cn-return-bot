import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the two-source rule (GOO-107) and the reader rule (GOO-135, GOO-182).
 * A creator is walked because their priority window is open, or because readers
 * read them, and for no other reason. Priority beats attention, attention
 * orders everyone else, and a creator we already know keeps their project even
 * when they qualify on attention alone. A reader is a browser that opened at
 * least two different pages of the creator. One reader is the floor, below
 * which a creator is not on the list at all; how far down the list the walk
 * goes above the floor is the budget's decision, covered in
 * autoEnqueue.test.ts. */

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

/** One creator's attention row. `readers` defaults to one, the floor, so a
 *  test that is about something else does not have to think about it. */
const read = (feedUrl: string, counts: { visits?: number; pages?: number; readers?: number } = {}) => ({
  feed_url: feedUrl,
  visits: counts.visits ?? 2,
  pages: counts.pages ?? 2,
  readers: counts.readers ?? 1,
});

const rankedSlugs = async () => (await rankCreators()).map((c) => c.project_slug);

describe("rankCreators, attention", () => {
  test("one reader is the floor: a browser that opened one page is not, and neither are visit rows on their own", async () => {
    // Rows without a reader hash raise the visit number and nothing else, so
    // however many there are they buy no walk.
    dbState.creatorAttention = [
      read("https://oneclick.substack.com", { visits: 9, pages: 1, readers: 0 }),
      read("https://read.substack.com", { visits: 2, pages: 2, readers: 1 }),
      read("https://hashless.substack.com", { visits: 30, pages: 0, readers: 0 }),
    ];
    expect(await rankedSlugs()).toEqual(["read"]);
  });

  test("creators order by readers, most first", async () => {
    dbState.creatorAttention = [
      read("https://one.substack.com", { pages: 9, readers: 1 }),
      read("https://three.substack.com", { pages: 6, readers: 3 }),
    ];
    expect(await rankedSlugs()).toEqual(["three", "one"]);
  });

  test("creators with the same readers order by how many different pages were opened", async () => {
    // Today almost every creator has exactly one reader, so this is the
    // ordering in practice. It ignores reloads, which the visit count did not.
    dbState.creatorAttention = [
      read("https://shallow.substack.com", { visits: 50, pages: 2 }),
      read("https://deep.substack.com", { visits: 8, pages: 7 }),
    ];
    expect(await rankedSlugs()).toEqual(["deep", "shallow"]);
  });

  test("the order is stable when everything ties", async () => {
    dbState.creatorAttention = [
      read("https://bbb.substack.com", { pages: 3 }),
      read("https://aaa.substack.com", { pages: 3 }),
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
    dbState.creatorProjects = [creator("popular"), creator("pressed", { priority_until: inDays(3) })];
    dbState.creatorAttention = [read("https://popular.substack.com", { pages: 20, readers: 9 })];
    expect(await rankedSlugs()).toEqual(["pressed", "popular"]);
  });

  test("a creator we know keeps their project when they qualify on attention alone", async () => {
    // A project's slug can carry a collision suffix, so deriving it from the
    // URL would say "thezvi", miss the real project, create a second one and
    // split the creator's notes on the public site. The URL is the key.
    dbState.creatorProjects = [{ ...creator("thezvi-2"), feed_url: "https://thezvi.substack.com" }];
    dbState.creatorAttention = [read("https://thezvi.substack.com", { visits: 4 })];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["thezvi-2"]);
    expect(creators[0]!.prioritized).toBe(false);
  });

  test("a creator we know keeps their top-posts stamp when walked on attention", async () => {
    // Without this the stamp reads as null, the creator looks permanently
    // overdue, and the walk re-fetches their top posts on every single run.
    const stamp = inDays(-1);
    dbState.creatorProjects = [creator("zvi", { top_posts_refreshed_at: stamp })];
    dbState.creatorAttention = [read("https://zvi.substack.com", { visits: 4 })];
    expect((await rankCreators())[0]!.top_posts_refreshed_at).toBe(stamp);
  });

  test("a creator we have never seen is walked under a slug derived from the url", async () => {
    dbState.creatorAttention = [read("https://www.youtube.com/@SomeChannel", { visits: 4 })];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["somechannel"]);
    expect(creators[0]!.top_posts_refreshed_at).toBeNull();
  });

  test("a trailing slash or different casing still matches a creator we know", async () => {
    dbState.creatorProjects = [creator("acx")];
    dbState.creatorAttention = [read("https://ACX.substack.com/", { visits: 3 })];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["acx"]);
    expect(creators[0]!.visits).toBe(3);
  });

  test("a prioritized creator carries their own numbers too", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(2) })];
    dbState.creatorAttention = [read("https://zvi.substack.com", { visits: 6, pages: 4, readers: 2 })];
    const zvi = (await rankCreators())[0]!;
    expect(zvi.visits).toBe(6);
    expect(zvi.readers).toBe(2);
  });

  test("a read feed URL of no known shape is skipped", async () => {
    dbState.creatorAttention = [read("https://example.com/some-blog", { visits: 7 })];
    expect(await rankedSlugs()).toEqual([]);
  });
});
