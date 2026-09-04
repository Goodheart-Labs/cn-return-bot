import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the two-source rule (GOO-107): a creator is walked because their
 * priority window is open, or because readers visited them at least twice in
 * the window, and for no other reason. Priority beats visits, visits order
 * everyone else, and a creator we already know keeps their project even when
 * they qualify on visits alone. */

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

const rankedSlugs = async () => (await rankCreators()).map((c) => c.project_slug);

describe("rankCreators", () => {
  test("a creator with neither priority nor visits is not walked at all", async () => {
    dbState.creatorProjects = [creator("zvi"), creator("acx")];
    expect(await rankedSlugs()).toEqual([]);
  });

  test("an open priority window walks a creator with no visits", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(3) }), creator("acx")];
    expect(await rankedSlugs()).toEqual(["zvi"]);
  });

  test("an expired window does not, and does not beat a visited creator", async () => {
    dbState.creatorProjects = [
      creator("expired", { priority_until: inDays(-1) }),
      creator("popular"),
    ];
    dbState.visitCounts = [{ feed_url: "https://popular.substack.com", visits: 5 }];
    expect(await rankedSlugs()).toEqual(["popular"]);
  });

  test("priority beats any visit count", async () => {
    dbState.creatorProjects = [
      creator("popular"),
      creator("pressed", { priority_until: inDays(3) }),
    ];
    dbState.visitCounts = [{ feed_url: "https://popular.substack.com", visits: 50 }];
    expect(await rankedSlugs()).toEqual(["pressed", "popular"]);
  });

  test("visited creators order by visit count, most visited first", async () => {
    dbState.visitCounts = [
      { feed_url: "https://few.substack.com", visits: 2 },
      { feed_url: "https://many.substack.com", visits: 9 },
    ];
    expect(await rankedSlugs()).toEqual(["many", "few"]);
  });

  test("two visits is enough, one is not", async () => {
    dbState.visitCounts = [
      { feed_url: "https://oneclick.substack.com", visits: 1 },
      { feed_url: "https://twoclicks.substack.com", visits: 2 },
    ];
    expect(await rankedSlugs()).toEqual(["twoclicks"]);
  });

  test("a creator we know keeps their project when they qualify on visits alone", async () => {
    // thezvi.substack.com is project "zvi" by hand. Deriving the slug from the
    // URL would say "thezvi", create a second project and split their notes on
    // the public site.
    dbState.creatorProjects = [{ ...creator("zvi"), feed_url: "https://thezvi.substack.com" }];
    dbState.visitCounts = [{ feed_url: "https://thezvi.substack.com", visits: 4 }];
    const ranked = await rankCreators();
    expect(ranked.map((c) => c.project_slug)).toEqual(["zvi"]);
    expect(ranked[0]!.prioritized).toBe(false);
  });

  test("a creator we know keeps their top-posts stamp when walked on visits", async () => {
    // Without this the stamp reads as null, the creator looks permanently
    // overdue, and the walk re-fetches their top posts on every single run.
    const stamp = inDays(-1);
    dbState.creatorProjects = [creator("zvi", { top_posts_refreshed_at: stamp })];
    dbState.visitCounts = [{ feed_url: "https://zvi.substack.com", visits: 4 }];
    expect((await rankCreators())[0]!.top_posts_refreshed_at).toBe(stamp);
  });

  test("a creator we have never seen is walked under a slug derived from the url", async () => {
    dbState.visitCounts = [{ feed_url: "https://www.youtube.com/@SomeChannel", visits: 4 }];
    const ranked = await rankCreators();
    expect(ranked.map((c) => c.project_slug)).toEqual(["somechannel"]);
    expect(ranked[0]!.top_posts_refreshed_at).toBeNull();
  });

  test("a trailing slash or different casing still matches a creator we know", async () => {
    dbState.creatorProjects = [creator("acx")];
    dbState.visitCounts = [{ feed_url: "https://ACX.substack.com/", visits: 3 }];
    const ranked = await rankCreators();
    expect(ranked.map((c) => c.project_slug)).toEqual(["acx"]);
    expect(ranked[0]!.visits).toBe(3);
  });

  test("a prioritized creator carries their visit count too", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(2) })];
    dbState.visitCounts = [{ feed_url: "https://zvi.substack.com", visits: 6 }];
    expect((await rankCreators())[0]!.visits).toBe(6);
  });

  test("a visited feed URL of no known shape is skipped", async () => {
    dbState.visitCounts = [{ feed_url: "https://example.com/some-blog", visits: 7 }];
    expect(await rankedSlugs()).toEqual([]);
  });

  test("the order is stable when priority and visits both tie", async () => {
    dbState.visitCounts = [
      { feed_url: "https://bbb.substack.com", visits: 3 },
      { feed_url: "https://aaa.substack.com", visits: 3 },
    ];
    expect(await rankedSlugs()).toEqual(["aaa", "bbb"]);
  });
});
