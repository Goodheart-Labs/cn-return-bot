import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { indexContainer, findQuoteMatch } from "./anchor";

function articleOf(html: string): Element {
  const { document } = parseHTML(`<html><body><article>${html}</article></body></html>`);
  return document.querySelector("article")!;
}

/** The raw page text a match spans, reconstructed from its node offsets. */
function matchedText(container: Element, quote: string): string | null {
  const index = indexContainer(container);
  const match = findQuoteMatch(index, quote);
  if (!match) return null;
  const nodes = index.segments.map((s) => s.node);
  const from = nodes.indexOf(match.start.node);
  const to = nodes.indexOf(match.end.node);
  let text = "";
  for (let i = from; i <= to; i++) {
    const data = nodes[i]!.data;
    const begin = i === from ? match.start.offset : 0;
    const stop = i === to ? match.end.offset + 1 : data.length;
    text += data.slice(begin, stop);
  }
  return text;
}

describe("findQuoteMatch", () => {
  test("exact quote inside one paragraph", () => {
    const article = articleOf("<p>The model was trained on 15 trillion tokens of data, according to the paper.</p>");
    expect(matchedText(article, "trained on 15 trillion tokens")).toBe("trained on 15 trillion tokens");
  });

  test("quote spanning inline formatting, including a mid-word split", () => {
    const article = articleOf("<p>Growth reached <strong>4.2 per</strong>cent in <em>the third quarter</em> of 2025.</p>");
    expect(matchedText(article, "Growth reached 4.2 percent in the third quarter")).toBe(
      "Growth reached 4.2 percent in the third quarter",
    );
  });

  test("smart quotes and dashes in the page, plain in the claim quote", () => {
    const article = articleOf("<p>She said the plan — “a complete overhaul” — would cost $3 billion.</p>");
    expect(matchedText(article, 'the plan -- "a complete overhaul" -- would cost $3 billion')).toBe(
      "the plan — “a complete overhaul” — would cost $3 billion",
    );
  });

  test("quote spanning a paragraph break", () => {
    const article = articleOf("<p>The first phase ends in March.</p><p>The second phase begins immediately after.</p>");
    expect(matchedText(article, "phase ends in March. The second phase begins")).toContain("phase ends in March");
  });

  test("edge-words fallback when the middle drifted", () => {
    const article = articleOf(
      "<p>The committee voted twelve to three in favor of the new zoning proposal that residents had opposed for months on end.</p>",
    );
    // Middle words differ from the page ("in favour of the amended zoning plan").
    const drifted = "The committee voted twelve to three in favour of the amended zoning plan that residents had opposed for months on end";
    expect(matchedText(article, drifted)).toBe(
      "The committee voted twelve to three in favor of the new zoning proposal that residents had opposed for months on end",
    );
  });

  test("no match for absent text", () => {
    const article = articleOf("<p>Nothing to see here at all.</p>");
    expect(matchedText(article, "a completely different sentence about turtles")).toBeNull();
  });

  test("too-short quotes refuse to anchor", () => {
    const article = articleOf("<p>The rate is 4%.</p>");
    expect(matchedText(article, "rate is")).toBeNull();
  });

  test("script/style content is not searchable", () => {
    const article = articleOf("<p>Visible text here for anchoring purposes.</p><script>const hidden = 'trained on 15 trillion tokens';</script>");
    expect(matchedText(article, "trained on 15 trillion tokens")).toBeNull();
  });
});
