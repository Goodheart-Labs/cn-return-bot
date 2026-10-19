import { describe, expect, test } from "bun:test";
import { buildClaimPost } from "./checkClaims";
import { claimCheckFields } from "./claimCheckFields";
import type { ExtractedClaim } from "../types";

const base: ExtractedClaim = {
  claim: "The bridge opened in 1932.",
  context: "the bridge opened in '32",
  contextParagraph: "As everyone knows, the bridge opened in '32, to great fanfare.",
  imageUrls: [],
  veryConfidentTrue: false,
  speculation: false,
  anchor: { kind: "substack", url: "https://example.com/p/x" },
};

describe("claimCheckFields", () => {
  test("uses the author's highlighted words and the passage, not the restatement", () => {
    expect(claimCheckFields(base, "youtube")).toEqual({
      "Highlighted claim from Transcript": "the bridge opened in '32",
      "Surrounding context": "As everyone knows, the bridge opened in '32, to great fanfare.",
    });
  });

  test("labels a Substack claim as coming from an article", () => {
    expect(Object.keys(claimCheckFields(base, "substack"))[0]).toBe("Highlighted claim from Article");
  });

  test("falls back to the restatement for an image-only claim", () => {
    const imageOnly = { ...base, context: "", contextParagraph: "", imageUrls: ["https://example.com/chart.png"] };
    expect(claimCheckFields(imageOnly, "substack")).toEqual({ Claim: "The bridge opened in 1932." });
  });
});

test("a reader's request carries the whole page after the claim and its paragraph", () => {
  expect(claimCheckFields({ ...base, page: "Title\n\nAs everyone knows, the bridge opened in '32, to great fanfare." }, "web")).toEqual({
    "Highlighted claim from Article": "the bridge opened in '32",
    "Surrounding context": "As everyone knows, the bridge opened in '32, to great fanfare.",
    "Full Article": "Title\n\nAs everyone knows, the bridge opened in '32, to great fanfare.",
  });
});

test("reader steer reaches the labelled search input without changing unsteered claims", () => {
  const post = buildClaimPost({ claim: { ...base, steer: "the bridge's opening date" }, source: "web", itemId: "article-1", index: 0 });
  expect(post.text).toContain("A reader asked for a note about: the bridge's opening date");
  expect(claimCheckFields({ ...base, steer: null }, "web")).toEqual(claimCheckFields(base, "web"));
});
