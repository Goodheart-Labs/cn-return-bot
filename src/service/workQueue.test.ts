import { describe, expect, test } from "bun:test";
import { WorkQueue, nextCallIndex } from "./workQueue";

/* These tests cover the two rules the queue exists for: urgent work is served
 * first, and reader work always finds a free slot even while the service is
 * otherwise full. */

const alwaysStartable = () => true;

describe("nextCallIndex", () => {
  test("serves the most urgent call first", () => {
    const calls = [
      { priority: "feed" as const, enqueuedAt: 1 },
      { priority: "x" as const, enqueuedAt: 2 },
      { priority: "reader" as const, enqueuedAt: 3 },
    ];
    expect(nextCallIndex(calls, alwaysStartable)).toBe(2);
  });

  test("serves the longest waiting of equally urgent calls", () => {
    const calls = [
      { priority: "reader" as const, enqueuedAt: 20 },
      { priority: "reader" as const, enqueuedAt: 10 },
    ];
    expect(nextCallIndex(calls, alwaysStartable)).toBe(1);
  });

  test("skips calls that may not start yet", () => {
    const calls = [
      { priority: "feed" as const, enqueuedAt: 1 },
      { priority: "reader" as const, enqueuedAt: 2 },
    ];
    expect(nextCallIndex(calls, (priority) => priority === "reader")).toBe(1);
  });

  test("reports that nothing may start", () => {
    const calls = [{ priority: "feed" as const, enqueuedAt: 1 }];
    expect(nextCallIndex(calls, () => false)).toBe(-1);
  });
});

/** A task that only finishes when the test says so, so the queue can be held in
 *  a known state. */
function heldTask() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { run: () => done, release };
}

describe("WorkQueue", () => {
  test("runs no more than the concurrency at once", async () => {
    const queue = new WorkQueue({ concurrency: 2, reservedForReader: 0 });
    const held = [heldTask(), heldTask(), heldTask()];
    held.forEach((task) => queue.run("feed", task.run));

    expect(queue.health("claim-check").inFlight).toBe(2);
    expect(queue.health("claim-check").waiting).toBe(1);

    held[0]!.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.health("claim-check").inFlight).toBe(2);
    expect(queue.health("claim-check").waiting).toBe(0);
    held.forEach((task) => task.release());
  });

  test("keeps slots free so reader work never waits behind feed work", async () => {
    const queue = new WorkQueue({ concurrency: 6, reservedForReader: 2 });
    const feed = Array.from({ length: 6 }, heldTask);
    feed.forEach((task) => queue.run("feed", task.run));

    // Feed work may fill only four of the six slots, so two stay waiting.
    expect(queue.health("claim-check").inFlight).toBe(4);
    expect(queue.health("claim-check").waiting).toBe(2);

    let readerStarted = false;
    const reader = heldTask();
    queue.run("reader", () => {
      readerStarted = true;
      return reader.run();
    });

    expect(readerStarted).toBe(true);
    expect(queue.health("claim-check").inFlight).toBe(5);

    feed.forEach((task) => task.release());
    reader.release();
  });

  test("reports how long the oldest waiting call has waited", () => {
    const queue = new WorkQueue({ concurrency: 1, reservedForReader: 0 });
    const running = heldTask();
    const waiting = heldTask();
    queue.run("feed", running.run);
    queue.run("feed", waiting.run);

    const health = queue.health("claim-check");
    expect(health.waiting).toBe(1);
    expect(health.oldestWaitSeconds).toBeGreaterThanOrEqual(0);

    running.release();
    waiting.release();
  });

  test("an empty queue reports no wait at all", () => {
    const queue = new WorkQueue({ concurrency: 1, reservedForReader: 0 });
    expect(queue.health("extraction").oldestWaitSeconds).toBeNull();
  });

  test("a failing task frees its slot", async () => {
    const queue = new WorkQueue({ concurrency: 1, reservedForReader: 0 });
    const failure = queue.run("feed", () => Promise.reject(new Error("boom")));
    await expect(failure).rejects.toThrow("boom");
    expect(queue.health("claim-check").inFlight).toBe(0);
  });
});
