import { describe, expect, test } from "bun:test";
import { calculateGrokCost } from "../cost-tracking/pricing";
import { getWarnings, withWarnings } from "../utils/warnings";
import { grokCallCost } from "./xai";

const USAGE = { inputTokens: 4000, outputTokens: 1000 };
const X_SEARCH_STEP = { toolCalls: [{ toolName: "x_search" }] };

describe("grokCallCost", () => {
  test("records the amount xAI billed, summed over every step", () => {
    const cost = grokCallCost({
      usage: USAGE,
      steps: [
        { ...X_SEARCH_STEP, response: { body: { usage: { cost_in_usd_ticks: 300_594_000 } } } },
        { response: { body: { usage: { cost_in_usd_ticks: 100_000_000 } } } },
      ],
    }, "grok-4-fast");
    expect(cost).toEqual({ input_tokens: 4000, output_tokens: 1000, cost: 0.0400594 });
  });

  test("falls back to the rate table with a warning when a step lacks the billed amount", () => {
    withWarnings(() => {
      const cost = grokCallCost({ usage: USAGE, steps: [{ ...X_SEARCH_STEP, response: { body: {} } }] }, "grok-4-fast");
      expect(cost).toEqual(calculateGrokCost(4000, 1000, 1, "grok-4-fast"));
      expect(getWarnings()).toHaveLength(1);
    });
  });
});
