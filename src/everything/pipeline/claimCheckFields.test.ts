import { describe, expect, test } from "bun:test";
import { buildClaimPost } from "./checkClaims";
import { claimCheckFields } from "./claimCheckFields";
import type { ExtractedClaim } from "../types";

const base: ExtractedClaim = {
  claim: "The bridge opened in 1932.",
  context: "the bridge opened in '32",
  contextParagraph: "As everyone knows, the bridge opened in '32, to great fanfare.",
  imageUrls: [],
  anchor: { kind: "substack", url: "https://example.com/p/x" },
};

describe("claimCheckFields", () => {
  test("gives the passage around the claim and the restatement", () => {
    expect(claimCheckFields(base, "youtube")).toEqual({
      "Text from Transcript": "As everyone knows, the bridge opened in '32, to great fanfare.",
      Claim: "The bridge opened in 1932.",
    });
  });

  test("labels a Substack claim as coming from an article", () => {
    expect(Object.keys(claimCheckFields(base, "substack"))[0]).toBe("Text from Article");
  });

  test("falls back to the highlighted words when the claim has no paragraph", () => {
    expect(claimCheckFields({ ...base, contextParagraph: "" }, "substack")["Text from Article"]).toBe("the bridge opened in '32");
  });

  test("gives only the restatement for an image-only claim", () => {
    const imageOnly = { ...base, context: "", contextParagraph: "", imageUrls: ["https://example.com/chart.png"] };
    expect(claimCheckFields(imageOnly, "substack")).toEqual({ Claim: "The bridge opened in 1932." });
  });
});

test("a reader's request carries the whole page after the claim and its paragraph", () => {
  expect(claimCheckFields({ ...base, page: "Title\n\nAs everyone knows, the bridge opened in '32, to great fanfare." }, "web")).toEqual({
    "Text from Article": "As everyone knows, the bridge opened in '32, to great fanfare.",
    Claim: "The bridge opened in 1932.",
    "Full Article": "Title\n\nAs everyone knows, the bridge opened in '32, to great fanfare.",
  });
});

test("reader steer reaches the labelled search input without changing unsteered claims", () => {
  const post = buildClaimPost({ claim: { ...base, steer: "the bridge's opening date" }, source: "web", itemId: "article-1", index: 0 });
  expect(post.text).toContain("A reader asked for a note about: the bridge's opening date");
  expect(claimCheckFields({ ...base, steer: null }, "web")).toEqual(claimCheckFields(base, "web"));
});
