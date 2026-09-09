import { describe, expect, test } from "bun:test";
import { applyRatings, parseRatingOutput, shouldFactCheck } from "./rateClaims";
import type { ExtractedClaim } from "../types";

const claim = (text: string): ExtractedClaim => ({
  claim: text,
  context: text,
  contextParagraph: text,
  imageUrls: [],
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
