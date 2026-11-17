import { beforeEach, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

mock.module("./db", dbMock);
const { recheckPage } = await import("./recheck");

beforeEach(resetDbState);

test("a finished page goes back in the queue, first among the feed posts", async () => {
  dbState.existingItem = { id: "item-1", status: "done", checked_scope: "page", first_checked_at: "2026-08-07T00:00:00Z" };
  expect(await recheckPage("https://example.com/post")).toBe("queued");
  expect(dbState.calls.requeueItem?.[0]).toEqual(["item-1"]);
  expect(dbState.calls.raiseItemPriority?.[0]).toEqual(["item-1", 1]);
});

test("a page a worker holds, a page already waiting and an unknown page are left alone", async () => {
  dbState.existingItem = { id: "item-1", status: "processing", checked_scope: "page", first_checked_at: null };
  expect(await recheckPage("https://example.com/post")).toBe("a worker is on it");
  dbState.existingItem = { id: "item-1", status: "queued", checked_scope: "page", first_checked_at: null };
  expect(await recheckPage("https://example.com/post")).toBe("already waiting");
  dbState.existingItem = null;
  expect(await recheckPage("https://example.com/post")).toBe("unknown page");
  expect(dbState.calls.requeueItem).toBeUndefined();
});
