import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers the two-source rule (GOO-107) and the score (GOO-257). A creator is
 * walked because their priority window is open, or because someone visited
 * them, and for no other reason. Priority beats the score, the score orders
 * everyone else, and a creator we already know keeps their project even when
 * they are walked on visits alone. How the database computes the score is
 * covered by migrations/119_creator_visit_score.verify.sql; how far down the
 * list the walk goes is covered in autoEnqueue.test.ts. */

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

/** One creator's score row. The defaults are one person who opened two posts,
 *  the smallest creator the walk accepts, so a test that is about something
 *  else does not have to think about it. */
const visited = (feedUrl: string, score: { perPost?: number; posts?: number; people?: number } = {}) => ({
  feed_url: feedUrl,
  visitors_per_post: score.perPost ?? 1,
  posts: score.posts ?? 2,
  people: score.people ?? 1,
});

const rankedSlugs = async () => (await rankCreators()).map((c) => c.project_slug);

describe("rankCreators, score", () => {
  test("a creator needs two visited posts, however many people opened the one post", async () => {
    dbState.creatorVisitScores = [
      visited("https://onehit.substack.com", { perPost: 8, posts: 1, people: 8 }),
      visited("https://twoposts.substack.com", { perPost: 1, posts: 2, people: 1 }),
    ];
    expect(await rankedSlugs()).toEqual(["twoposts"]);
  });

  test("a prioritized creator is walked with fewer than two visited posts", async () => {
    dbState.creatorProjects = [creator("pressed", { priority_until: inDays(3) })];
    dbState.creatorVisitScores = [visited("https://pressed.substack.com", { posts: 1 })];
    expect(await rankedSlugs()).toEqual(["pressed"]);
  });

  test("creators order by the average number of people per post, so a few widely read posts beat many lightly read ones", async () => {
    dbState.creatorVisitScores = [
      visited("https://daily.substack.com", { perPost: 1.2, posts: 10, people: 9 }),
      visited("https://monthly.substack.com", { perPost: 4, posts: 2, people: 5 }),
    ];
    expect(await rankedSlugs()).toEqual(["monthly", "daily"]);
  });

  test("creators with the same average order by how many different people visited them", async () => {
    dbState.creatorVisitScores = [
      visited("https://few.substack.com", { perPost: 1, people: 1 }),
      visited("https://many.substack.com", { perPost: 1, people: 7 }),
    ];
    expect(await rankedSlugs()).toEqual(["many", "few"]);
  });

  test("the order is stable when everything ties", async () => {
    dbState.creatorVisitScores = [visited("https://bbb.substack.com"), visited("https://aaa.substack.com")];
    expect(await rankedSlugs()).toEqual(["aaa", "bbb"]);
  });
});

describe("rankCreators, priority and projects", () => {
  test("a creator with neither priority nor visits is not walked at all", async () => {
    dbState.creatorProjects = [creator("zvi"), creator("acx")];
    expect(await rankedSlugs()).toEqual([]);
  });

  test("an open priority window walks a creator nobody has read", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(3) }), creator("acx")];
    expect(await rankedSlugs()).toEqual(["zvi"]);
  });

  test("an expired window does not, and does not beat a visited creator", async () => {
    dbState.creatorProjects = [creator("expired", { priority_until: inDays(-1) }), creator("popular")];
    dbState.creatorVisitScores = [visited("https://popular.substack.com")];
    expect(await rankedSlugs()).toEqual(["popular"]);
  });

  test("priority beats any score", async () => {
    dbState.creatorProjects = [creator("popular"), creator("pressed", { priority_until: inDays(3) })];
    dbState.creatorVisitScores = [visited("https://popular.substack.com", { perPost: 9, posts: 10, people: 40 })];
    expect(await rankedSlugs()).toEqual(["pressed", "popular"]);
  });

  test("a creator we know keeps their project when walked on visits alone", async () => {
    // A project's slug can carry a collision suffix, so deriving it from the
    // URL would say "thezvi", miss the real project, create a second one and
    // split the creator's notes on the public site. The URL is the key.
    dbState.creatorProjects = [{ ...creator("thezvi-2"), feed_url: "https://thezvi.substack.com" }];
    dbState.creatorVisitScores = [visited("https://thezvi.substack.com")];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["thezvi-2"]);
    expect(creators[0]!.prioritized).toBe(false);
  });

  test("a creator we know keeps their top-posts stamp when walked on visits alone", async () => {
    // Without this the stamp reads as null, the creator looks permanently
    // overdue, and the walk re-fetches their top posts on every single run.
    const stamp = inDays(-1);
    dbState.creatorProjects = [creator("zvi", { top_posts_refreshed_at: stamp })];
    dbState.creatorVisitScores = [visited("https://zvi.substack.com")];
    expect((await rankCreators())[0]!.top_posts_refreshed_at).toBe(stamp);
  });

  test("a creator we have never seen is walked under a slug derived from the url", async () => {
    dbState.creatorVisitScores = [visited("https://www.youtube.com/@SomeChannel")];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["somechannel"]);
    expect(creators[0]!.top_posts_refreshed_at).toBeNull();
  });

  test("a trailing slash or different casing still matches a creator we know", async () => {
    dbState.creatorProjects = [creator("acx")];
    dbState.creatorVisitScores = [visited("https://ACX.substack.com/", { perPost: 3 })];
    const creators = await rankCreators();
    expect(creators.map((c) => c.project_slug)).toEqual(["acx"]);
    expect(creators[0]!.score.visitors_per_post).toBe(3);
  });

  test("a prioritized creator carries their own numbers too", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(2) })];
    dbState.creatorVisitScores = [visited("https://zvi.substack.com", { perPost: 2.5, posts: 10, people: 15 })];
    const zvi = (await rankCreators())[0]!;
    expect(zvi.score).toEqual({ visitors_per_post: 2.5, posts: 10, people: 15 });
  });

  test("a prioritized creator nobody visited has a score of zero", async () => {
    dbState.creatorProjects = [creator("zvi", { priority_until: inDays(2) })];
    expect((await rankCreators())[0]!.score.visitors_per_post).toBe(0);
  });

  test("a visited feed URL of no known shape is skipped", async () => {
    dbState.creatorVisitScores = [visited("https://example.com/some-blog")];
    expect(await rankedSlugs()).toEqual([]);
  });
});
