import { describe, expect, mock, test } from "bun:test";
import type { Route } from "./routing";

// Analytics needs the Supabase client, so the test stubs it before loading.
void mock.module("./analytics", () => ({ capturePageview: () => {} }));
const { readRoute, routeHref } = await import("./routing");

const ROUTES: [string, Route][] = [
  ["/", { view: "home", section: null }],
  ["/install", { view: "home", section: "install" }],
  ["/notes", { view: "notes", project: null, item: null, note: null }],
  ["/notes/all", { view: "allNotes" }],
  ["/admin/best", { view: "bestNotes", project: null }],
  ["/admin/best/zvi", { view: "bestNotes", project: "zvi" }],
  ["/notes/zvi", { view: "notes", project: "zvi", item: null, note: null }],
  ["/notes/zvi/item-1", { view: "notes", project: "zvi", item: "item-1", note: null }],
  ["/notes/zvi?note=n-1", { view: "notes", project: "zvi", item: null, note: "n-1" }],
  ["/leaderboard", { view: "leaderboard" }],
  ["/minisites", { view: "minisites", slug: null }],
  ["/minisites/new", { view: "newMinisite" }],
  ["/admin/notes", { view: "noteReview" }],
  ["/admin/dashboard", { view: "dashboard" }],
  ["/minisites/big-tent-or-small-tent", { view: "minisites", slug: "big-tent-or-small-tent" }],
];

describe("routing", () => {
  test.each(ROUTES)("%s reads and writes as the same route", (address, route) => {
    const [pathname, search = ""] = address.split("?");
    expect(readRoute(pathname!, search ? `?${search}` : "")).toEqual(route);
    expect(routeHref(route)).toBe(address);
  });

  test("old best-notes links that name a section still open the leaderboard", () => {
    expect(readRoute("/admin/best/recommendations", "")).toEqual({ view: "bestNotes", project: null });
    expect(readRoute("/admin/best/leaderboard/zvi", "")).toEqual({ view: "bestNotes", project: "zvi" });
  });

  test("old review links that name a section open the review page", () => {
    expect(readRoute("/admin/notes/approved", "")).toEqual({ view: "noteReview" });
  });

  test("a trailing slash reads as the same page", () => {
    expect(readRoute("/notes/zvi/", "")).toEqual({ view: "notes", project: "zvi", item: null, note: null });
  });

  test("old query-parameter links still open their page", () => {
    expect(readRoute("/", "?view=notes")).toEqual({ view: "notes", project: null, item: null, note: null });
    expect(readRoute("/", "?project=zvi&episode=item-1&note=n-1")).toEqual({ view: "notes", project: "zvi", item: "item-1", note: "n-1" });
    expect(readRoute("/", "?view=leaderboard")).toEqual({ view: "leaderboard" });
    expect(readRoute("/", "?section=install")).toEqual({ view: "home", section: "install" });
  });

  test("the old article reader's links show the homepage", () => {
    expect(readRoute("/read", "?url=https%3A%2F%2Fexample.com%2Fp")).toEqual({ view: "home", section: null });
  });

  test("an unknown path shows the homepage", () => {
    expect(readRoute("/nothing-here", "")).toEqual({ view: "home", section: null });
  });
});
