import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import { JUDGEMENTS, RATING_SYSTEM_PROMPT, applyRatings, parseRatingOutput, rateClaims, shouldFactCheck } from "./rateClaims";

// The OpenAI SDK's create method is replaced, so no test reaches OpenRouter while
// our own client code still runs. Each request is kept so a test can check what
// was sent.
const requests: any[] = [];
let nextReplies: any[] = [];
let createSpy: ReturnType<typeof spyOn>;
const originalApiKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY ??= "local-test-only";
  requests.length = 0;
  createSpy = spyOn((OpenAI as any).Chat.Completions.prototype, "create").mockImplementation(async (params: any) => {
    requests.push(params);
    return nextReplies.shift();
  });
});
afterEach(() => {
  createSpy.mockRestore();
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
});
import type { ExtractedClaim } from "../types";

const claim = (text: string): ExtractedClaim => ({
  claim: text,
  context: text,
  contextParagraph: text,
  imageUrls: [],
  veryConfidentTrue: false,
  speculation: false,
  anchor: { kind: "substack", url: "https://example.com/p/x" },
});
const claims = [claim("first"), claim("second"), claim("third")];

describe("applyRatings", () => {
  test("matches ratings to claims by their number", () => {
    const rated = applyRatings(claims, [
      { claim: 1, rating: "likely true" },
      { claim: 2, rating: "certainly false" },
      { claim: 3, rating: "uncertain" },
    ]);
    expect(rated.map((c) => c.judgement)).toEqual(["likely true", "certainly false", "uncertain"]);
  });

  test("a claim the model left out is treated as uncertain", () => {
    const rated = applyRatings(claims, [{ claim: 1, rating: "likely true" }]);
    expect(rated.map((c) => c.judgement)).toEqual(["likely true", "uncertain", "uncertain"]);
  });

  test("a rating outside the scale is treated as uncertain", () => {
    const rated = applyRatings(claims, [
      { claim: 1, rating: "probably fine" },
      { claim: 2, rating: "likely true" },
      { claim: 3, rating: "likely true" },
    ]);
    expect(rated[0]!.judgement).toBe("uncertain");
  });

  test("a claim number that does not exist is ignored", () => {
    const rated = applyRatings(claims, [
      { claim: 0, rating: "likely true" },
      { claim: 4, rating: "likely true" },
      { claim: 2, rating: "likely true" },
    ]);
    expect(rated.map((c) => c.judgement)).toEqual(["uncertain", "likely true", "uncertain"]);
  });
});

describe("parseRatingOutput", () => {
  test("accepts the expected shape", () => {
    const out = parseRatingOutput(`{"research":"x https://a.b","ratings":[{"claim":1,"rating":"likely true"}]}`);
    expect(out.ratings).toHaveLength(1);
  });

  test("reads ratings written as an object keyed by claim number", () => {
    const out = parseRatingOutput(`{"research":"x","ratings":{"1":"likely true","2":"uncertain"}}`);
    expect(out.ratings).toEqual([
      { claim: 1, rating: "likely true" },
      { claim: 2, rating: "uncertain" },
    ]);
  });

  test("rejects a missing ratings list", () => {
    expect(() => parseRatingOutput(`{"research":"x"}`)).toThrow();
  });

  test("rejects an entry without a claim number", () => {
    expect(() => parseRatingOutput(`{"research":"x","ratings":[{"rating":"likely true"}]}`)).toThrow();
  });
});

describe("shouldFactCheck", () => {
  test("checks uncertain and everything below it", () => {
    expect(shouldFactCheck("somewhat likely true")).toBe(false);
    expect(shouldFactCheck("uncertain")).toBe(true);
    expect(shouldFactCheck("likely false")).toBe(true);
  });

  test("checks a judgement it does not recognize", () => {
    expect(shouldFactCheck("no idea")).toBe(true);
  });
});

describe("rateClaims research call", () => {
  test("researches with Meta's search in one call, reads past the narration, and records its cost and searches", async () => {
    nextReplies = [{
      choices: [{ message: { content: `Checking the claim.\n\n{"research":"x https://a.b","ratings":[{"claim":1,"rating":"likely true"}]}` } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0125, server_tool_use_details: { web_search_requests: 4 } },
    }];
    const result = await rateClaims({ text: "part", introduction: null, claims: [claim("first")], source: "substack" });
    expect(requests).toHaveLength(1);
    expect(requests[0].tools).toEqual([{ type: "openrouter:web_search", parameters: { engine: "native" } }]);
    expect(result.claims[0]!.judgement).toBe("likely true");
    expect(result.cost.cost).toBeCloseTo(0.0125, 10);
    expect(result.webSearches).toBe(4);
  });

  test("a retry for clean JSON goes without the search tool, so the research is not paid for twice", async () => {
    nextReplies = [
      { choices: [{ message: { content: "I could not finish." } }], usage: { cost: 0.01, server_tool_use_details: { web_search_requests: 3 } } },
      { choices: [{ message: { content: `{"research":"x","ratings":[{"claim":1,"rating":"uncertain"}]}` } }], usage: { cost: 0.001 } },
    ];
    const result = await rateClaims({ text: "part", introduction: null, claims: [claim("first")], source: "substack" });
    expect(requests).toHaveLength(2);
    expect(requests[1].tools).toBeUndefined();
    expect(result.cost.cost).toBeCloseTo(0.011, 10);
    expect(result.webSearches).toBe(3);
  });
});

describe("RATING_SYSTEM_PROMPT", () => {
  test("names every level of the scale the rating is parsed against", () => {
    for (const judgement of JUDGEMENTS) expect(RATING_SYSTEM_PROMPT).toContain(judgement);
  });
});
