import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the creator ranking: flags beat visits, visits order everyone else,
 * the stored feed order breaks ties, and visited-but-unfollowed creators only
 * join the walk when the switch is on. */

mock.module("./db", dbMock);

beforeEach(() => {
  resetDbState();
  delete process.env.EVERYTHING_VISIT_CREATORS;
});
afterEach(() => {
  delete process.env.EVERYTHING_VISIT_CREATORS;
});

const { rankCreators } = await import("./creatorRanking");

const DAY_MS = 24 * 3600_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

const feed = (slug: string, overrides: Partial<(typeof dbState.followedFeeds)[number]> = {}) => ({
  project_slug: slug,
  feed_type: "substack" as const,
  feed_url: `https://${slug}.substack.com`,
  priority: 0,
  priority_until: null,
  ...overrides,
});

const rankedSlugs = async () => (await rankCreators()).map((c) => c.project_slug);

describe("rankCreators", () => {
  test("visits reorder the stored feeds, most visited first", async () => {
    dbState.followedFeeds = [feed("zvi"), feed("acx"), feed("slowboring")];
    dbState.visitCounts = [
      { feed_url: "https://acx.substack.com", visits: 5 },
      { feed_url: "https://slowboring.substack.com", visits: 2 },
    ];
    expect(await rankedSlugs()).toEqual(["acx", "slowboring", "zvi"]);
  });

  test("equal visit counts keep the stored order", async () => {
    dbState.followedFeeds = [feed("zvi"), feed("acx")];
    expect(await rankedSlugs()).toEqual(["zvi", "acx"]);
  });

  test("an unexpired flag beats any visit count, an expired one does not", async () => {
    dbState.followedFeeds = [
      feed("popular"),
      feed("flagged", { priority_until: inDays(3) }),
      feed("expired", { priority_until: inDays(-1) }),
    ];
    dbState.visitCounts = [
      { feed_url: "https://popular.substack.com", visits: 50 },
      { feed_url: "https://expired.substack.com", visits: 20 },
    ];
    expect(await rankedSlugs()).toEqual(["flagged", "popular", "expired"]);
  });

  test("a trailing slash or different casing still matches a stored feed", async () => {
    dbState.followedFeeds = [feed("zvi"), feed("acx")];
    dbState.visitCounts = [{ feed_url: "https://ACX.substack.com/", visits: 3 }];
    const ranked = await rankCreators();
    expect(ranked.map((c) => c.project_slug)).toEqual(["acx", "zvi"]);
    expect(ranked[0]!.visits).toBe(3);
  });

  test("visited-but-unfollowed creators stay out while the switch is off", async () => {
    dbState.followedFeeds = [feed("zvi")];
    dbState.visitCounts = [{ feed_url: "https://stranger.substack.com", visits: 9 }];
    expect(await rankedSlugs()).toEqual(["zvi"]);
  });

  test("with the switch on, visited creators join, ranked by visits", async () => {
    process.env.EVERYTHING_VISIT_CREATORS = "on";
    dbState.followedFeeds = [feed("zvi")];
    dbState.visitCounts = [
      { feed_url: "https://stranger.substack.com", visits: 9 },
      { feed_url: "https://www.youtube.com/@SomeChannel", visits: 4 },
    ];
    const ranked = await rankCreators();
    expect(ranked.map((c) => c.feed_url)).toEqual([
      "https://stranger.substack.com",
      "https://www.youtube.com/@SomeChannel",
      "https://zvi.substack.com",
    ]);
    expect(ranked[1]!.feed_type).toBe("youtube");
  });

  test("a visited creator ties with a stored feed → the stored feed wins", async () => {
    process.env.EVERYTHING_VISIT_CREATORS = "on";
    dbState.followedFeeds = [feed("zvi")];
    dbState.visitCounts = [
      { feed_url: "https://zvi.substack.com", visits: 4 },
      { feed_url: "https://stranger.substack.com", visits: 4 },
    ];
    expect(await rankedSlugs()).toEqual(["zvi", "stranger"]);
  });

  test("a visited feed URL of no known shape is skipped", async () => {
    process.env.EVERYTHING_VISIT_CREATORS = "on";
    dbState.visitCounts = [{ feed_url: "https://example.com/some-blog", visits: 7 }];
    expect(await rankedSlugs()).toEqual([]);
  });
});
