import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "../everything/dbMock";

/* cn-walk adds a recent post that has no item, makes a reader-note or
 * paragraph item a whole-page check, and leaves a whole-page item alone. */

mock.module("../everything/db", dbMock);
beforeEach(resetDbState);

const { addNewPosts, recentEntries } = await import("./posts");

const creator = { project_slug: "test", feed_type: "substack" as const, feed_url: "https://test.substack.com", prioritized: false, priorityUntil: null, score: { visitors_per_post: 1, posts: 2, people: 2 }, walkScore: 1 };
const today = new Date().toISOString().slice(0, 10);
const entry = (url: string, publishedAt = today) => ({ source: "substack" as const, url, matchKey: url, title: url, fullText: "Body", publishedAt });

describe("recentEntries", () => {
  test("posts older than two weeks are left out", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(recentEntries([entry("a", "2026-11-06"), entry("b", "2026-11-04")], now).map((e) => e.url)).toEqual(["a"]);
  });
});

describe("addNewPosts", () => {
  test("a recent post without an item is added with its text", async () => {
    dbState.knownItems = [];
    expect(await addNewPosts(creator, "Test", [entry("https://test.substack.com/p/new")], false)).toBe(1);
    const [rows] = dbState.calls.enqueueItems![0]! as [{ url: string; full_text: string }[]];
    expect(rows.map((r) => [r.url, r.full_text])).toEqual([["https://test.substack.com/p/new", "Body"]]);
  });

  test("a whole-page item is left alone, whatever its status", async () => {
    dbState.knownItems = [{ id: "i1", url: "https://test.substack.com/p/old", checked_scope: "page" }];
    expect(await addNewPosts(creator, "Test", [entry("https://test.substack.com/p/old")], false)).toBe(0);
    expect(dbState.calls.enqueueItems).toBeUndefined();
  });

  test("a reader-note item becomes a whole-page check, without a request", async () => {
    dbState.knownItems = [{ id: "i1", url: "https://test.substack.com/p/noted", checked_scope: null }];
    expect(await addNewPosts(creator, "Test", [entry("https://test.substack.com/p/noted")], false)).toBe(1);
    expect(dbState.calls.promoteItemToWholePage?.[0]).toEqual(["i1", "Body", { requested: false }]);
    expect(dbState.calls.enqueueItems).toBeUndefined();
  });

  test("a dry run writes nothing", async () => {
    dbState.knownItems = [];
    expect(await addNewPosts(creator, "Test", [entry("https://test.substack.com/p/new")], true)).toBe(1);
    expect(dbState.calls.enqueueItems).toBeUndefined();
  });
});
