import { describe, expect, test } from "bun:test";
import { GEMINI_PRICING, GROK_PRICING } from "./pricing";
import { AB_TESTS } from "../ab-testing/abTestsData";

/* Grok and Gemini searches run on the vendors' own APIs, which report no cost the
 * way OpenRouter does. We work their cost out from the rate tables in pricing.ts.
 * A model with no row there records every one of its runs at cost 0, and nothing
 * fails. That happened to grok-4.5, which ran for a month at an apparent cost of
 * nothing and made its cost-per-helpful-note look better than every other arm.
 *
 * These tests fail the build when an A/B arm names a model that has no rate. */

/** Reads the models an A/B test can select for a given search strategy. The
 *  stored ids carry a provider prefix that the dispatcher strips before calling
 *  the vendor, so we strip it the same way. */
function searchModelsFor(webSearch: string, prefix: string): string[] {
  const test = AB_TESTS.find((t) => t.name === "simple_bot_search");
  if (!test) throw new Error("simple_bot_search test not found");
  return test.variants
    .filter((v) => v.weight > 0)
    .map((v) => v.variant.overrides)
    .filter((o: any) => o.web_search === webSearch)
    .map((o: any) => String(o.search_model).replace(prefix, ""));
}

describe("native-API arms have a pricing row", () => {
  test("every live native_grok arm is priced", () => {
    const models = searchModelsFor("native_grok", "x-ai/");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(GROK_PRICING[model], `no GROK_PRICING row for "${model}"`).toBeDefined();
    }
  });

  test("every live native_gemini arm is priced", () => {
    const models = searchModelsFor("native_gemini", "google/");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(GEMINI_PRICING[model], `no GEMINI_PRICING row for "${model}"`).toBeDefined();
    }
  });
});
