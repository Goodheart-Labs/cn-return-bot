import { describe, expect, test } from "bun:test";
import type { ClaimRef } from "@cn/core/types";
import { highlightedTextParts, anchorForSelection, mapNotesToBlocks, parseReaderText } from "./readerText";

function note(id: string, context: Partial<ClaimRef> = {}) {
  return {
    id,
    claim: {
      id: `claim-${id}`,
      item_id: "essay",
      claim: "A rewritten claim is never source text.",
      context_quote: null,
      context_paragraph: null,
      updated_quote: null,
      context_url: null,
      image_urls: [],
      start_seconds: null,
      end_seconds: null,
      ...context,
    } satisfies ClaimRef,
  };
}

describe("reader text structure", () => {
  test("retains source wording while separating headings, paragraphs and lists", () => {
    const blocks = parseReaderText(
      "# A Synthetic Essay\r\n\r\nFirst paragraph, with *emphasis*.\r\nA wrapped line.\r\n\r\nSecond section\r\n--------------\r\n\r\n- First choice\r\n  with a continuation\r\n- Second choice\r\n\r\n1. First step\r\n2. Second step",
    );
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "heading", "list", "list"]);
    expect(blocks[0]).toMatchObject({ text: "A Synthetic Essay", sourceText: "# A Synthetic Essay", level: 1 });
    expect(blocks[1]?.text).toBe("First paragraph, with *emphasis*.\nA wrapped line.");
    expect(blocks[2]).toMatchObject({ text: "Second section", level: 2 });
    expect(blocks[3]).toMatchObject({ ordered: false, items: ["First choice\nwith a continuation", "Second choice"] });
    expect(blocks[4]).toMatchObject({ ordered: true, items: ["First step", "Second step"] });
  });

  test("plain text headings are preserved as paragraphs instead of guessing", () => {
    const blocks = parseReaderText("A short statement\n\nThe complete sentence continues here.");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
    expect(blocks.map((block) => block.text).join("\n\n")).toBe("A short statement\n\nThe complete sentence continues here.");
    expect(parseReaderText("## The C# example ##")[0]?.text).toBe("The C# example");
    expect(parseReaderText("## C#")[0]?.text).toBe("C#");
  });

  test("fragment ids survive preceding insertions and remain unique for duplicates", () => {
    const original = parseReaderText("One complete paragraph.\n\nA second paragraph.");
    const expanded = parseReaderText("New introduction.\n\nOne complete paragraph.\n\nA second paragraph.\n\nOne complete paragraph.");
    expect(expanded[1]?.id).toBe(original[0]?.id);
    expect(expanded[2]?.id).toBe(original[1]?.id);
    expect(new Set(expanded.map((block) => block.id)).size).toBe(expanded.length);
  });

  test("empty source text has no fabricated body", () => {
    expect(parseReaderText(null)).toEqual([]);
    expect(parseReaderText(undefined)).toEqual([]);
    expect(parseReaderText(" \r\n\t")).toEqual([]);
  });
});

describe("reader note anchoring", () => {
  test("matches source punctuation and whitespace through the shared normalizer", () => {
    const blocks = parseReaderText("The first paragraph has no note.\n\nWe should consider ‘careful testing’ before release.");
    const entry = note("one", { context_quote: "consider careful\n testing before release" });
    const result = mapNotesToBlocks(blocks, [entry]);
    expect(result.byBlock.get(blocks[1]!.id)).toEqual([entry]);
    expect(result.unanchored).toEqual([]);
  });

  test("prefers updated wording and falls back to an unchanged context paragraph", () => {
    const blocks = parseReaderText("The old proposal required just one evaluation.\n\nThe new proposal requires three independent evaluations.\n\nA final paragraph records a different policy.");
    const updated = note("updated", {
      updated_quote: "requires three independent evaluations",
      context_quote: "required just one evaluation",
    });
    const drifted = note("drifted", {
      context_quote: "wording which is not present",
      context_paragraph: "A final paragraph records a different policy.",
    });
    const result = mapNotesToBlocks(blocks, [updated, drifted]);
    expect(result.byBlock.get(blocks[1]!.id)).toEqual([updated]);
    expect(result.byBlock.get(blocks[2]!.id)).toEqual([drifted]);
  });

  test("uses context to disambiguate repeated quotations", () => {
    const blocks = parseReaderText("At the start, careful testing should come first.\n\nIn the conclusion, careful testing should come first before widespread release.");
    const entry = note("repeated", {
      context_quote: "careful testing should come first",
      context_paragraph: "In the conclusion, careful testing should come first before widespread release.",
    });
    expect(mapNotesToBlocks(blocks, [entry]).byBlock.get(blocks[1]!.id)).toEqual([entry]);
  });

  test("matches quotations spanning paragraphs to their largest overlapping block", () => {
    const blocks = parseReaderText("Begin with careful testing.\n\nIndependent reviewers should examine every major release before deployment.");
    const entry = note("spanning", { context_quote: "careful testing. Independent reviewers should examine every major release" });
    expect(mapNotesToBlocks(blocks, [entry]).byBlock.get(blocks[1]!.id)).toEqual([entry]);
  });

  test("does not misplace missing, short, ambiguous, or image-only quotations", () => {
    const blocks = parseReaderText("We need careful testing before release.\n\nThey also need careful testing before release.\n\nThe subtotal evidence is inconclusive.");
    const entries = [
      note("missing", { context_quote: "This sentence does not appear in this article." }),
      note("short", { context_quote: "release" }),
      note("repeated", { context_quote: "careful testing before release" }),
      note("word-boundary", { context_quote: "total evidence is inconclusive" }),
      note("image-only", { image_urls: ["https://example.com/chart.png"] }),
      { id: "no-claim", claim: null },
    ];
    const result = mapNotesToBlocks(blocks, entries);
    expect(result.byBlock.size).toBe(0);
    expect(result.unanchored).toEqual(entries);
  });

  test("handles empty data and keeps multiple notes on the same passage", () => {
    const blocks = parseReaderText("All major systems should receive independent evaluation.");
    const entries = [note("first", { context_quote: blocks[0]!.text }), note("second", { context_quote: blocks[0]!.text })];
    expect(mapNotesToBlocks([], entries).unanchored).toEqual(entries);
    expect(mapNotesToBlocks(blocks, []).byBlock.size).toBe(0);
    expect(mapNotesToBlocks(blocks, entries).byBlock.get(blocks[0]!.id)).toEqual(entries);
  });
});

describe("reader writing helpers", () => {
  test("keeps title, date and unmarked section lines as source paragraphs", () => {
    const text = "An Article Title\nSeptember 2026\n\nThe introduction.\nA section title\n\nThe next paragraph.";
    const blocks = parseReaderText(text);
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocks.map((block) => block.text).join("\n\n")).toBe(text);
  });

  test("widens a selection to whole words and refuses short or foreign text", () => {
    const block = parseReaderText("Not building the technology deprives humanity of benefits, while\nbuilding it too fast is reckless.")[0]!;
    expect(anchorForSelection(block, "ilding the technology depri")).toBe("building the technology deprives");
    // A selection across the wrapped line matches with whitespace collapsed.
    expect(anchorForSelection(block, "benefits, while\nbuilding it")).toBe("benefits, while building it");
    expect(anchorForSelection(block, "too fast")).toBeNull();
    expect(anchorForSelection(block, "words from another passage entirely")).toBeNull();
    expect(anchorForSelection(block, "   ")).toBeNull();
  });

  test("a note written on a selection comes back beside the same passage", () => {
    const blocks = parseReaderText("First passage says one thing about pacing.\n\nSecond passage says the technology deprives nobody.\n\nThird passage repeats: the technology deprives nobody.");
    const second = blocks[1]!;
    const anchor = anchorForSelection(second, "technology deprives nobody")!;
    // The anchored words recur in the third passage; the paragraph decides.
    const placed = mapNotesToBlocks(blocks, [note("n1", { context_quote: anchor, context_paragraph: second.text })]);
    expect(placed.byBlock.get(second.id)?.map((n) => n.id)).toEqual(["n1"]);
    expect(placed.unanchored).toHaveLength(0);
    // A whole-passage anchor places itself too.
    const whole = mapNotesToBlocks(blocks, [note("n2", { context_quote: second.text, context_paragraph: second.text })]);
    expect(whole.byBlock.get(second.id)?.map((n) => n.id)).toEqual(["n2"]);
  });
});


test("overlapping highlights tint the entire union, including a longer quote after a shorter one", () => {
  const text = "Demand could double by 2035. Storage matters.";
  expect(highlightedTextParts(text, ["Demand could double", "Demand could double by 2035."])).toEqual([
    { text: "Demand could double by 2035.", highlighted: true }, { text: " Storage matters.", highlighted: false },
  ]);
  expect(highlightedTextParts(text, ["Demand could double", "double by 2035."])).toEqual([
    { text: "Demand could double by 2035.", highlighted: true }, { text: " Storage matters.", highlighted: false },
  ]);
});

test("highlight matching preserves whitespace and escapes regular expression punctuation", () => {
  expect(highlightedTextParts("A [50%]\nchance.", ["[50%] chance.", " "])).toEqual([
    { text: "A ", highlighted: false }, { text: "[50%]\nchance.", highlighted: true },
  ]);
});
