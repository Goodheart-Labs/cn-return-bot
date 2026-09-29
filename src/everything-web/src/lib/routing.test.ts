import { describe, expect, mock, test } from "bun:test";
import type { Route } from "./routing";

// Vite sets the base address at build time, and analytics needs the Supabase
// client, so the test provides the one and stubs the other before loading.
process.env.BASE_URL = "/";
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
