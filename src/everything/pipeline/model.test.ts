import { describe, expect, test } from "bun:test";
import { claudeExtractionModels, extractionModels, withExtractionModels } from "./model";

describe("extractionModels", () => {
  test("runs on production's Muse model outside an override", () => {
    expect(extractionModels().model).toBe("meta/muse-spark-1.3-contributor");
  });

  test("an override applies inside its callback and nowhere after it", async () => {
    const claude = claudeExtractionModels("anthropic/claude-sonnet-5.5", "medium");
    const inside = await withExtractionModels(claude, async () => {
      await Promise.resolve();
      return extractionModels();
    });
    expect(inside.model).toBe("anthropic/claude-sonnet-5.5");
    expect(inside.reasoning).toEqual({ gate: "medium", extraction: "medium", rating: "medium" });
    expect(inside.ratingTools.map((t: any) => t.type)).toEqual(["web_search_20260209", "web_fetch_20250910"]);
    expect(extractionModels().model).toBe("meta/muse-spark-1.3-contributor");
  });
});
