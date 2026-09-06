import { describe, expect, test } from "bun:test";
import { pickVariantName, runABTests } from "./abTests";
import { AB_TESTS, BOT_TEST, type ABTest } from "./abTestsData";

const weighted: ABTest = {
  name: "weighted",
  variants: [
    { variant: { name: "retired-first", overrides: {} }, weight: 0 },
    { variant: { name: "a", overrides: {} }, weight: 25 },
    { variant: { name: "retired-middle", overrides: {} }, weight: 0 },
    { variant: { name: "b", overrides: {} }, weight: 75 },
    { variant: { name: "retired-last", overrides: {} }, weight: 0 },
  ],
};

describe("A/B sampling", () => {
  test("only positive-weight arms can be drawn, including at boundaries", () => {
    for (const [draw, expected] of [[0, "a"], [0.2499, "a"], [0.25, "b"], [0.9999, "b"]] as const) {
      expect(pickVariantName(weighted, undefined, () => draw)).toBe(expected);
    }
  });

  test("zero-weight arms still work when explicitly forced", () => {
    expect(pickVariantName(weighted, "retired-first")).toBe("retired-first");
    expect(() => pickVariantName(weighted, "typo")).toThrow('has no variant named "typo"');
    expect(() => pickVariantName(weighted, "")).toThrow('has no variant named ""');
  });

  test("invalid weights and unsampleable standalone tests fail explicitly", () => {
    for (const weight of [-1, NaN, Infinity, 0]) {
      const invalid = { ...weighted, variants: [{ ...weighted.variants[0]!, weight }] };
      expect(() => pickVariantName(invalid)).toThrow();
    }
    expect(() => pickVariantName({ ...weighted, variants: [] })).toThrow();
  });

  test("the pipeline skips an entirely retired test", () => {
    const retired = { ...weighted, variants: weighted.variants.map(v => ({ ...v, weight: 0 })) };
    expect(runABTests([BOT_TEST, retired]).picks).toEqual({ bot: "simple-bot" });
  });

  test("every configured experiment draws a live arm at zero", () => {
    for (const experiment of AB_TESTS) {
      if (!experiment.variants.some(v => v.weight > 0)) continue;
      const chosen = pickVariantName(experiment, undefined, () => 0);
      expect(experiment.variants.find(v => v.variant.name === chosen)!.weight).toBeGreaterThan(0);
    }
  });
});
