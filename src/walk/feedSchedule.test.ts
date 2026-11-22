import { describe, expect, test } from "bun:test";
import { FEED_READS_PER_DAY, feedWaits, kindsBelowBar, listRank, MIN_SECONDS_BETWEEN_FEED_READS, nextDue, REST_FEED_READS_PER_DAY, restFeedSchedule } from "./feedSchedule";

const DAY_MS = 24 * 3600_000;
const readsPerDay = (wait: number) => DAY_MS / wait;

describe("feedWaits", () => {
  test("the reads follow the square root of the score and use the whole budget", () => {
    const waits = feedWaits([
      { feedUrl: "a", score: 1, prioritized: false },
      { feedUrl: "b", score: 4, prioritized: false },
      { feedUrl: "c", score: 9, prioritized: false },
    ], 600);
    expect(readsPerDay(waits.get("a")!)).toBeCloseTo(100);
    expect(readsPerDay(waits.get("b")!)).toBeCloseTo(200);
    expect(readsPerDay(waits.get("c")!)).toBeCloseTo(300);
  });

  test("a creator holding priority is read at the floor, and a feed at the floor leaves its rest to the others", () => {
    const floor = MIN_SECONDS_BETWEEN_FEED_READS * 1000;
    const waits = feedWaits([
      { feedUrl: "priority", score: 0, prioritized: true },
      { feedUrl: "huge", score: 10_000, prioritized: false },
      { feedUrl: "small", score: 1, prioritized: false },
    ], 10_000);
    expect(waits.get("priority")).toBe(floor);
    expect(waits.get("huge")).toBe(floor);
    expect(readsPerDay(waits.get("small")!)).toBeCloseTo(10_000 - 2 * (DAY_MS / floor));
  });

  test("with 128 feeds from score 10.2 down to 1.03, as on 2026-11-19, the top feed is read sqrt(10.2 / 1.03) times as often as the last", () => {
    const feeds = Array.from({ length: 128 }, (_, i) => ({ feedUrl: `f${i}`, score: 10.2 - (i * (10.2 - 1.03)) / 127, prioritized: false }));
    const waits = feedWaits(feeds, FEED_READS_PER_DAY);
    expect(waits.get("f127")! / waits.get("f0")!).toBeCloseTo(Math.sqrt(10.2 / 1.03));
    const total = [...waits.values()].reduce((sum, wait) => sum + readsPerDay(wait), 0);
    expect(total).toBeCloseTo(FEED_READS_PER_DAY);
  });
});

describe("nextDue", () => {
  test("a read on time keeps the rhythm", () => {
    expect(nextDue(1000, 100, 1010)).toBe(1100);
  });
  test("a feed more than one waiting time behind starts again from now", () => {
    expect(nextDue(1000, 100, 1300)).toBe(1300);
  });
});

describe("creators below the walk's bar", () => {
  test("each Substack below the bar is read once an hour, and the walked ones share what is left", () => {
    const { restWait, walkedReadsPerDay } = restFeedSchedule(59);
    expect(readsPerDay(restWait)).toBeCloseTo(REST_FEED_READS_PER_DAY);
    expect(walkedReadsPerDay).toBe(FEED_READS_PER_DAY - 59 * REST_FEED_READS_PER_DAY);
  });

  test("however many there are, they take at most a fifth of the budget", () => {
    const { restWait, walkedReadsPerDay } = restFeedSchedule(5000);
    expect(walkedReadsPerDay).toBe(FEED_READS_PER_DAY * 0.8);
    expect(readsPerDay(restWait) * 5000).toBeCloseTo(FEED_READS_PER_DAY / 5);
  });

  test("none of them leaves the walked budget whole", () => {
    expect(restFeedSchedule(0).walkedReadsPerDay).toBe(FEED_READS_PER_DAY);
  });

  test("a creator below the bar ranks under every walked creator, by score among themselves", () => {
    const lowestWalked = listRank({ prioritized: false, walkScore: 1 }, true, 1000);
    const onePopularPost = listRank({ prioritized: false, walkScore: 1.4 }, false, 1000);
    const oneReader = listRank({ prioritized: false, walkScore: 0.7 }, false, 1000);
    expect(onePopularPost).toBeLessThan(lowestWalked);
    expect(oneReader).toBeLessThan(onePopularPost);
    expect(listRank({ prioritized: true, walkScore: 0.6 }, true, 1000)).toBe(1000.6);
  });

  test("unset lists the text kinds, videos only when named, and 0 nobody", () => {
    expect([...kindsBelowBar(undefined)]).toEqual(["substack", "lesswrong"]);
    expect(kindsBelowBar("substack, lesswrong,youtube").has("youtube")).toBe(true);
    expect(kindsBelowBar("0").size).toBe(0);
    expect(kindsBelowBar("").size).toBe(0);
  });
});
