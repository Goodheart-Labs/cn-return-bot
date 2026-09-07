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

  test("materiality_treatment samples only for simple-bot, one fix per run", () => {
    const experiment = AB_TESTS.find(test => test.name === "materiality_treatment")!;
    expect(pickVariantName(experiment, undefined, () => 0)).toBe("judge_gate");
    expect(pickVariantName(experiment, undefined, () => 0.5)).toBe("writer_central");
    for (const botId of ["simple-bot", "other-bot"]) {
      const bot: ABTest = {
        name: "bot",
        variants: [{ variant: { name: botId, overrides: { botId } }, weight: 100 }],
      };
      const { picks, config } = runABTests([bot, experiment]);
      if (botId === "simple-bot") {
        expect(picks.materiality_treatment).toMatch(/^(judge_gate|writer_central)$/);
        const gated = picks.materiality_treatment === "judge_gate";
        expect(config.materiality_gate_threshold).toBe(gated ? 0.5 : undefined);
        expect(config.writer_central_claim).toBe(!gated);
      } else {
        expect(picks.materiality_treatment).toBeUndefined();
        expect(config.materiality_gate_threshold).toBeUndefined();
        expect(config.writer_central_claim).toBeUndefined();
      }
    }
  });

  test("writer_last_check has no live arms", () => {
    const experiment = AB_TESTS.find(test => test.name === "writer_last_check")!;
    expect(experiment.variants.every(variant => variant.weight === 0)).toBe(true);
    expect(runABTests([BOT_TEST, experiment]).picks).toEqual({ bot: "simple-bot" });
  });

  test("every configured experiment draws a live arm at zero", () => {
    for (const experiment of AB_TESTS) {
      if (!experiment.variants.some(v => v.weight > 0)) continue;
      const chosen = pickVariantName(experiment, undefined, () => 0);
      expect(experiment.variants.find(v => v.variant.name === chosen)!.weight).toBeGreaterThan(0);
    }
  });
});
