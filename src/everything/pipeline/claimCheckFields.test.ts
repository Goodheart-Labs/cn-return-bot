import { describe, expect, test } from "bun:test";
import { buildClaimPost } from "./checkClaims";
import { claimCheckFields } from "./claimCheckFields";
import type { ExtractedClaim } from "../types";

const base: ExtractedClaim = {
  claim: "The bridge opened in 1932.",
  context: "As everyone knows, the bridge opened in '32, to great fanfare.",
  imageUrls: [],
  anchor: { kind: "substack", url: "https://example.com/p/x" },
};

describe("claimCheckFields", () => {
  test("gives only the author's own words, not the restatement", () => {
    expect(claimCheckFields(base, "youtube")).toEqual({
      "Passage from Transcript": "As everyone knows, the bridge opened in '32, to great fanfare.",
    });
  });

  test("labels a Substack claim as coming from an article", () => {
    expect(Object.keys(claimCheckFields(base, "substack"))[0]).toBe("Passage from Article");
  });

  test("gives the description of an image for a point that is an image", () => {
    const image = { ...base, claim: "Description: A bar chart of bridge traffic.", context: "", imageUrls: ["https://example.com/chart.png"] };
    expect(claimCheckFields(image, "substack")).toEqual({ Image: "Description: A bar chart of bridge traffic." });
  });
});

test("reader steer reaches the labelled search input without changing unsteered claims", () => {
  const post = buildClaimPost({ claim: { ...base, steer: "the bridge's opening date" }, source: "web", itemId: "article-1", index: 0 });
  expect(post.text).toContain("A reader asked for a note about: the bridge's opening date");
  expect(claimCheckFields({ ...base, steer: null }, "web")).toEqual(claimCheckFields(base, "web"));
});
