import { describe, expect, test } from "bun:test";
import { createFeedLoop, type FeedLoopOptions } from "./feedLoop";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A loop over a fixed list of items that each take `itemMs`. Every item is
 *  due at once unless `waitBetweenStartsMs` says otherwise. */
function loopOver(itemCount: number, itemMs: number, overrides: Partial<FeedLoopOptions> = {}) {
  const stats = { started: 0, finished: 0, maxInFlight: 0, inFlight: 0, pacingQuestions: 0, heartbeats: 0 };
  const loop = createFeedLoop({
    maxItemsInFlight: 3,
    maxSleepMs: 20,
    maxPacingAnswerAgeMs: 1000,
    recordSeen: async () => {
      stats.heartbeats++;
    },
    startItemIfDue: async (start) => {
      stats.pacingQuestions++;
      if (stats.started >= itemCount) return 1000;
      stats.started++;
      start(async () => {
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        await sleep(itemMs);
        stats.inFlight--;
        stats.finished++;
      });
      return 0;
    },
    ...overrides,
  });
  return { loop, stats };
}

describe("createFeedLoop", () => {
  test("works every item, never more than the limit side by side", async () => {
    const { loop, stats } = loopOver(8, 15);
    const running = loop.run();
    await sleep(120);
    loop.drain();
    await running;
    expect(stats.finished).toBe(8);
    expect(stats.maxInFlight).toBe(3);
  });

  test("a finished item wakes a full loop long before its sleep would end", async () => {
    const { loop, stats } = loopOver(4, 10, { maxSleepMs: 5000 });
    const running = loop.run();
    await sleep(60);
    // Three start at once; the fourth can only have started if the first
    // finish woke the loop out of its five-second sleep.
    expect(stats.started).toBe(4);
    loop.drain();
    await running;
  });

  test("draining starts nothing new, finishes what is in flight, and then ends", async () => {
    const { loop, stats } = loopOver(100, 40);
    const running = loop.run();
    await sleep(10);
    loop.drain();
    await running;
    expect(stats.started).toBe(3);
    expect(stats.finished).toBe(3);
  });

  test("the heartbeat keeps going without asking the pacing rule again", async () => {
    const { loop, stats } = loopOver(0, 0, { maxSleepMs: 5 });
    const running = loop.run();
    await sleep(60);
    loop.drain();
    await running;
    expect(stats.heartbeats).toBeGreaterThan(5);
    expect(stats.pacingQuestions).toBe(1);
  });

  test("the pacing rule is asked again once its answer has run out", async () => {
    const { loop, stats } = loopOver(0, 0, { maxSleepMs: 5, maxPacingAnswerAgeMs: 20 });
    const running = loop.run();
    await sleep(70);
    loop.drain();
    await running;
    expect(stats.pacingQuestions).toBeGreaterThanOrEqual(3);
  });

  test("an item whose outcome could not be recorded stops the loop with that error", async () => {
    const loop = createFeedLoop({
      maxItemsInFlight: 3,
      maxSleepMs: 20,
      maxPacingAnswerAgeMs: 1000,
      recordSeen: async () => {},
      startItemIfDue: async (start) => {
        start(async () => {
          throw new Error("could not record");
        });
        return 1000;
      },
    });
    expect(loop.run()).rejects.toThrow("could not record");
  });
});
