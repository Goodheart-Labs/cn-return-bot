import { describe, expect, test } from "bun:test";
import { orderForSubmit, partitionByBar } from "./submitOrder";
import { pickRankingPolicy } from "./policy";

const id = (x: number) => x;

describe("orderForSubmit", () => {
  test("sorts by score, highest first, keeping pipeline order on ties", () => {
    const cands = [{ n: "a", s: 1 }, { n: "b", s: 3 }, { n: "c", s: 3 }, { n: "d", s: 2 }];
    expect(orderForSubmit(cands, (c) => c.s).map((c) => c.n)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("partitionByBar", () => {
  test("no bar keeps everything", () => {
    const p = partitionByBar([5, 1, 3], id, null, 0.1);
    expect(p.above).toEqual([5, 1, 3]);
    expect(p.explored).toEqual([]);
  });

  test("splits at the bar and explores about ten percent of the kept count", () => {
    const ordered = [...Array(40).keys()].map((i) => 100 - i); // 100..61 above a bar of 80: 20 kept
    const p = partitionByBar(ordered, id, 80, 0.1, () => 0.99); // 21 kept → floor(2.1 + 0.99) = 3 explored
    expect(p.above.length).toBe(21);
    expect(p.explored.length).toBe(3);
    expect(p.below.length).toBe(16);
    for (const x of p.explored) expect(x).toBeLessThan(80);
  });

  test("with nothing above the bar, nothing is posted", () => {
    const p = partitionByBar([1, 2, 3], id, 10, 0.1, () => 0.99);
    expect(p.above).toEqual([]);
    expect(p.explored).toEqual([]);
    expect(p.below).toEqual([1, 2, 3]);
  });

  test("seeded exploration samples across the rest and preserves its membership", () => {
    let seed = 9;
    const rng = () => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const ordered = Array.from({ length: 40 }, (_, i) => 100 - i);
    const rest = ordered.filter((x) => x < 80);
    const { explored, below } = partitionByBar(ordered, id, 80, 0.1, rng);
    expect(explored.length).toBe(2);
    expect(explored).not.toEqual(rest.slice(0, explored.length));
    expect(explored.every((x) => rest.includes(x))).toBe(true);
    expect(explored.every((x) => !below.includes(x))).toBe(true);
    expect(explored.length + below.length).toBe(rest.length);
    expect(new Set([...explored, ...below])).toEqual(new Set(rest));
  });
});

describe("pickRankingPolicy", () => {
  test("a forced pick wins", () => {
    expect(pickRankingPolicy("flags_then_eval", () => 0.01)).toBe("flags_then_eval");
  });

  test("an unknown forced policy is rejected before ranking", () => {
    expect(() => pickRankingPolicy("typo")).toThrow('has no variant named "typo"');
    expect(() => pickRankingPolicy("")).toThrow('has no variant named ""');
  });

  test("samples by weight", () => {
    expect(pickRankingPolicy(undefined, () => 0.01)).toBe("velocity_only");
    expect(pickRankingPolicy(undefined, () => 0.99)).toBe("flags_then_eval");
  });
});
