import { describe, expect, test } from "bun:test";
import { paragraphAround } from "./selectionParagraph";

const article = [
  "Given the many differences between brains and LLMs, claiming that an AI is conscious requires a high bar of evidence.",
  "LONDON—AI agents are not conscious. They do not feel, experience, or suffer. They do not have innate preferences or underlying motivations.",
  "If humanity is to flourish in the 21st century, that is how they must remain.",
].join("\n\n");

describe("paragraphAround", () => {
  test("returns the whole paragraph the selected words sit in", () => {
    expect(paragraphAround(article, "They do not have innate preferences")).toBe(
      "LONDON—AI agents are not conscious. They do not feel, experience, or suffer. They do not have innate preferences or underlying motivations.",
    );
  });

  test("returns every paragraph a selection crosses", () => {
    expect(paragraphAround(article, "underlying motivations.\nIf humanity")).toBe(article.split("\n\n").slice(1).join("\n\n"));
  });

  test("matches a selection whose whitespace differs from the page", () => {
    expect(paragraphAround(article, "They do  not\nhave innate")).toContain("LONDON—AI agents");
  });

  test("returns the selection itself when the words are not on the page", () => {
    expect(paragraphAround(article, "words from somewhere else")).toBe("words from somewhere else");
  });

  test("takes a window of whole words when the page has no paragraph breaks", () => {
    const transcript = Array.from({ length: 2000 }, (_, i) => `cue number ${i}`).join("\n");
    const paragraph = paragraphAround(transcript, "cue number 1000");
    expect(paragraph).toContain("cue number 1000");
    expect(paragraph.length).toBeLessThan(2500);
    const at = transcript.indexOf(paragraph);
    expect(at === 0 || /\s/.test(transcript[at - 1]!)).toBe(true);
  });
});
