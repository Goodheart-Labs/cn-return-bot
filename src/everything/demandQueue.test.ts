import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* The rule that queues a page because readers opened it: which pages it takes,
 * at which tier, and when it stops. The db module is mocked, so no database
 * runs; the mock applies the reader bars as everything_demanded_pages does. */

mock.module("./db", dbMock);
mock.module("./pipeline/cleanCapturedText", () => ({ cleanCapturedPageText: (text: string) => Promise.resolve({ text, costUsd: 0 }) }));
mock.module("./spendCap", () => ({ requestBudgetExhausted: () => Promise.resolve(false) }));

const { demandSettings, queueDemandedPages, setting } = await import("./demandQueue");

const text = (n: number, readers = 3) => ({
  page_url: `https://writer.substack.com/p/post-${n}`,
  feed_url: "https://writer.substack.com",
  kind: "text" as const,
  readers,
});
const video = (n: number, readers = 5) => ({
  page_url: `https://www.youtube.com/watch?v=video${n}`,
  feed_url: null,
  kind: "youtube" as const,
  readers,
});
const queuedUrls = () => (dbState.calls.insertQueuedItem ?? []).map(([row]) => (row as { url: string }).url);

beforeEach(resetDbState);

describe("queueDemandedPages", () => {
  test("a text post is queued at its third reader and a video at its fifth, by default", async () => {
    dbState.demandedPages = [text(1, 3), text(2, 2), video(1, 5), video(2, 4)];
    expect(await queueDemandedPages(demandSettings({}))).toBe(2);
    expect(queuedUrls()).toEqual([text(1).page_url, video(1).page_url]);
  });

  test("a queued page sits behind reader requests and ahead of the backlog walk", async () => {
    dbState.demandedPages = [text(1), video(1)];
    await queueDemandedPages(demandSettings({}));
    const rows = dbState.calls.insertQueuedItem!.map(([row]) => row as { priority: number; source: string; checked_scope: string });
    for (const row of rows) {
      expect(row.priority).toBeLessThan(dbMock().QUEUE_PRIORITY.requested);
      expect(row.priority).toBeGreaterThan(dbMock().QUEUE_PRIORITY.backlog);
      expect(row.checked_scope).toBe("page");
    }
    expect(rows.map((r) => r.source)).toEqual(["web", "youtube"]);
  });

  test("every queued page is recorded, so the database never offers it again", async () => {
    dbState.demandedPages = [text(1, 4)];
    await queueDemandedPages(demandSettings({}));
    expect(dbState.calls.recordDemandQueued).toEqual([
      [{ page_url: text(1).page_url, kind: "text", readers: 4, queued: true }],
    ]);
  });

  test("a page the log cannot record is not queued, and the pass ends", async () => {
    dbState.demandedPages = [text(1), text(2)];
    dbState.recordDemandFails = true;
    await expect(queueDemandedPages(demandSettings({}))).rejects.toThrow("log is down");
    expect(dbState.calls.insertQueuedItem).toBeUndefined();
  });

  test("the daily cap counts what the last 24 hours already queued", async () => {
    dbState.demandedPages = [video(1), video(2), video(3), text(1)];
    dbState.demandReport = [{ kind: "youtube", queued_24h: 18, settled: 0, checked: 0, with_notes: 0 }];
    expect(await queueDemandedPages(demandSettings({}))).toBe(3);
    expect(queuedUrls()).toEqual([video(1).page_url, video(2).page_url, text(1).page_url]);
  });

  test("a kind at its cap is not even asked for", async () => {
    dbState.demandedPages = [video(1), text(1)];
    dbState.demandReport = [{ kind: "youtube", queued_24h: 20, settled: 0, checked: 0, with_notes: 0 }];
    await queueDemandedPages(demandSettings({}));
    expect(queuedUrls()).toEqual([text(1).page_url]);
  });

  test("0 switches a kind off, as a bar or as a cap", async () => {
    dbState.demandedPages = [video(1, 9), text(1, 9)];
    expect(await queueDemandedPages(demandSettings({ EVERYTHING_DEMAND_YOUTUBE_READERS: "0" }))).toBe(1);
    expect(queuedUrls()).toEqual([text(1).page_url]);
    resetDbState();
    dbState.demandedPages = [video(1, 9), text(1, 9)];
    expect(await queueDemandedPages(demandSettings({ EVERYTHING_DEMAND_TEXT_DAILY_CAP: "0", EVERYTHING_DEMAND_YOUTUBE_DAILY_CAP: "0" }))).toBe(0);
    expect(queuedUrls()).toEqual([]);
  });

  test("a page that already has an item is recorded and left alone", async () => {
    dbState.demandedPages = [video(1)];
    dbState.existingItem = { id: "item-1", status: "error", checked_scope: "page", first_checked_at: null };
    expect(await queueDemandedPages(demandSettings({}))).toBe(0);
    expect(dbState.calls.insertQueuedItem).toBeUndefined();
    expect(dbState.calls.requeueItem).toBeUndefined();
    expect(dbState.calls.recordDemandQueued![0]![0]).toMatchObject({ queued: false });
  });
});

describe("setting", () => {
  test("empty or unreadable means the default, 0 means off", () => {
    expect(setting(undefined, 3)).toBe(3);
    expect(setting("", 3)).toBe(3);
    expect(setting("many", 3)).toBe(3);
    expect(setting("-1", 3)).toBe(3);
    expect(setting("0", 3)).toBe(0);
    expect(setting("5", 3)).toBe(5);
  });
});
