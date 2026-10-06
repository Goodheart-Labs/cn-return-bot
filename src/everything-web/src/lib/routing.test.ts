import { describe, expect, mock, test } from "bun:test";
import type { Route } from "./routing";

// Analytics needs the Supabase client, so the test stubs it before loading.
void mock.module("./analytics", () => ({ capturePageview: () => {} }));
const { readRoute, routeHref } = await import("./routing");

const ROUTES: [string, Route][] = [
  ["/", { view: "home", section: null }],
  ["/install", { view: "home", section: "install" }],
  ["/notes", { view: "notes", project: null, item: null, note: null }],
  ["/notes/zvi", { view: "notes", project: "zvi", item: null, note: null }],
  ["/notes/zvi/item-1", { view: "notes", project: "zvi", item: "item-1", note: null }],
  ["/notes/zvi?note=n-1", { view: "notes", project: "zvi", item: null, note: "n-1" }],
  ["/leaderboard", { view: "leaderboard" }],
  ["/minisites", { view: "minisites", slug: null }],
  ["/minisites/new", { view: "newMinisite" }],
  ["/minisites/big-tent-or-small-tent", { view: "minisites", slug: "big-tent-or-small-tent" }],
  ["/read?url=https%3A%2F%2Fexample.com%2Fp", { view: "read", url: "https://example.com/p", full: null }],
  ["/read?url=https%3A%2F%2Fexample.com%2Fp&full=https%3A%2F%2Fexample.com%2Fp.pdf", { view: "read", url: "https://example.com/p", full: "https://example.com/p.pdf" }],
];

describe("routing", () => {
  test.each(ROUTES)("%s reads and writes as the same route", (address, route) => {
    const [pathname, search = ""] = address.split("?");
    expect(readRoute(pathname!, search ? `?${search}` : "")).toEqual(route);
    expect(routeHref(route)).toBe(address);
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

  test("an unknown path shows the homepage", () => {
    expect(readRoute("/nothing-here", "")).toEqual({ view: "home", section: null });
  });
});
