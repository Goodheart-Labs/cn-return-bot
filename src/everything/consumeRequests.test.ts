import { beforeEach, describe, expect, mock, test } from "bun:test";

/* These tests cover the decision table in consumeNoteRequest: which existing
 * items refuse a request, which are promoted to a whole-page check, and which
 * are only bumped in priority. The db module is mocked, so no database runs. */

const calls: Record<string, unknown[][]> = {};
const record = (name: string) => (...args: unknown[]) => {
  (calls[name] ??= []).push(args);
  return Promise.resolve(name === "insertQueuedItem" ? "new-item-id" : name === "resolveProjectId" ? "project-id" : undefined);
};

let existingItem: { id: string; status: string; checked_scope: "page" | "paragraph" | null } | null = null;

mock.module("./db", () => ({
  fillProjectDisplayName: () => Promise.resolve(),
  fillProjectDisplayNameBySlug: () => Promise.resolve(),
  QUEUE_PRIORITY: { requested: 2, followed: 1, backlog: 0 },
  findItemForPageUrl: () => Promise.resolve(existingItem),
  promoteItemToWholePage: record("promoteItemToWholePage"),
  raiseItemPriority: record("raiseItemPriority"),
  requeueItem: record("requeueItem"),
  resolveNoteRequest: record("resolveNoteRequest"),
  insertQueuedItem: record("insertQueuedItem"),
  resolveProjectId: record("resolveProjectId"),
  fetchPendingNoteRequests: () => Promise.resolve([]),
  fetchPendingFollowRequests: () => Promise.resolve([]),
  fetchFollowedFeeds: () => Promise.resolve([]),
  insertFollowedFeed: record("insertFollowedFeed"),
  resolveFollowRequest: record("resolveFollowRequest"),
}));
mock.module("./pipeline/cleanCapturedText", () => ({
  cleanCapturedPageText: (text: string) => Promise.resolve(`cleaned:${text}`),
}));

const { consumeNoteRequest } = await import("./consumeRequests");

const request = (overrides: Record<string, unknown> = {}) => ({
  id: "req-1",
  page_url: "https://example.com/post",
  page_title: "A post",
  selection: null,
  page_text: null,
  ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  existingItem = null;
});

describe("consumeNoteRequest", () => {
  test("a finished whole-page check refuses the request", async () => {
    existingItem = { id: "item-1", status: "done", checked_scope: "page" };
    const line = await consumeNoteRequest(request() as never);
    expect(line).toContain("already checked");
    expect(calls.resolveNoteRequest?.[0]).toEqual(["req-1", "done", "page was already checked", "item-1"]);
    expect(calls.promoteItemToWholePage).toBeUndefined();
  });

  test("an item a worker is holding leaves the request pending", async () => {
    existingItem = { id: "item-1", status: "processing", checked_scope: "page" };
    const line = await consumeNoteRequest(request() as never);
    expect(line).toContain("stays pending");
    expect(calls.resolveNoteRequest).toBeUndefined();
  });

  test("a reader-note item is promoted with the cleaned page text", async () => {
    existingItem = { id: "item-1", status: "done", checked_scope: null };
    const line = await consumeNoteRequest(request({ page_text: "body" }) as never);
    expect(line).toContain("promoted");
    expect(calls.promoteItemToWholePage?.[0]).toEqual(["item-1", "cleaned:body", 2]);
    expect(calls.resolveNoteRequest?.[0]).toEqual(["req-1", "enqueued", null, "item-1"]);
  });

  test("a paragraph item is promoted and the request row says the whole page was checked instead", async () => {
    existingItem = { id: "item-1", status: "done", checked_scope: "paragraph" };
    await consumeNoteRequest(request({ selection: "some passage" }) as never);
    expect(calls.promoteItemToWholePage?.[0]?.[0]).toBe("item-1");
    expect(calls.resolveNoteRequest?.[0]).toEqual(["req-1", "enqueued", "checked the whole page instead", "item-1"]);
  });

  test("a promoted YouTube item carries no text, so the worker fetches the transcript", async () => {
    existingItem = { id: "item-1", status: "done", checked_scope: null };
    await consumeNoteRequest(request({ page_url: "https://www.youtube.com/watch?v=abcdefghijk", page_text: "player chrome" }) as never);
    expect(calls.promoteItemToWholePage?.[0]).toEqual(["item-1", null, 2]);
  });

  test("a queued whole-page item is only bumped, keeping its body text", async () => {
    existingItem = { id: "item-1", status: "queued", checked_scope: "page" };
    const line = await consumeNoteRequest(request() as never);
    expect(line).toContain("bumped");
    expect(calls.promoteItemToWholePage).toBeUndefined();
    expect(calls.requeueItem).toBeUndefined();
    expect(calls.raiseItemPriority?.[0]).toEqual(["item-1", 2]);
  });

  test("an errored whole-page item is requeued and bumped", async () => {
    existingItem = { id: "item-1", status: "error", checked_scope: "page" };
    await consumeNoteRequest(request() as never);
    expect(calls.requeueItem?.[0]).toEqual(["item-1"]);
    expect(calls.raiseItemPriority?.[0]).toEqual(["item-1", 2]);
  });

  test("a fresh whole-page request inserts a page-scope item", async () => {
    await consumeNoteRequest(request({ page_text: "body" }) as never);
    const row = calls.insertQueuedItem?.[0]?.[0] as Record<string, unknown>;
    expect(row.checked_scope).toBe("page");
    expect(row.full_text).toBe("cleaned:body");
  });

  test("a fresh paragraph request inserts a paragraph-scope item whose text is the selection", async () => {
    await consumeNoteRequest(request({ selection: "just this bit" }) as never);
    const row = calls.insertQueuedItem?.[0]?.[0] as Record<string, unknown>;
    expect(row.checked_scope).toBe("paragraph");
    expect(row.full_text).toBe("just this bit");
  });
});
