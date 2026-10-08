import { describe, expect, test } from "bun:test";
import {
  anchorForSelection, findQuoteMarks, mapQuotesToBlocks, markRuns, parseInline, parseReaderText, plainText,
  withoutRepeatedHeader, type AnchorQuote,
} from "./readerText";

const quoteOf = (entry: { quote: AnchorQuote | null }) => entry.quote;
const entry = (id: string, quote: Partial<AnchorQuote> | null = {}) => ({
  id,
  quote: quote && { context_quote: null, context_paragraph: null, updated_quote: null, ...quote },
});

describe("inline markup", () => {
  test("links, emphasis, strong, code and footnote references become runs", () => {
    const runs = parseInline("A [2019 report](https://example.org/r) said *very* **real** `x` risks.[^1]");
    expect(runs).toEqual([
      { text: "A " },
      { text: "2019 report", href: "https://example.org/r" },
      { text: " said " },
      { text: "very", em: true },
      { text: " " },
      { text: "real", strong: true },
      { text: " " },
      { text: "x", code: true },
      { text: " risks." },
      { text: "", footnote: "1" },
    ]);
  });

  test("unclosed markup, snake_case, maths and non-web links stay text", () => {
    const text = (s: string) => parseInline(s).map((run) => run.text).join("");
    expect(text("5 * 3 = 15 and a_b_c")).toBe("5 * 3 = 15 and a_b_c");
    expect(parseInline("a_b_c")).toEqual([{ text: "a_b_c" }]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ text: "[x](javascript:alert(1))" }]);
    expect(text("\\*not emphasis\\*")).toBe("*not emphasis*");
  });
});

describe("reader text blocks", () => {
  test("headings, paragraphs and lists keep their words, without markup", () => {
    const blocks = parseReaderText(
      "# A Synthetic Essay\r\n\r\nFirst paragraph, with *emphasis*.\r\nA wrapped line.\r\n\r\nSecond section\r\n--------------\r\n\r\n- First choice\r\n  with a continuation\r\n- Second choice\r\n\r\n1. First step\r\n2. Second step",
    );
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "heading", "list", "list"]);
    expect(blocks[0]).toMatchObject({ text: "A Synthetic Essay", level: 2 });
    expect(blocks[1]?.text).toBe("First paragraph, with emphasis.\nA wrapped line.");
    expect(blocks[2]).toMatchObject({ text: "Second section", level: 3 });
    expect(blocks[3]).toMatchObject({ ordered: false, text: "First choice\nwith a continuation\nSecond choice" });
    expect(blocks[4]).toMatchObject({ ordered: true, start: 1, text: "First step\nSecond step" });
  });

  test("list items separated by blank lines stay one list, and numbering keeps its start", () => {
    const blocks = parseReaderText("3. Third\n\n4. Fourth\n\nAfter.");
    expect(blocks.map((block) => block.kind)).toEqual(["list", "paragraph"]);
    expect(blocks[0]).toMatchObject({ ordered: true, start: 3, text: "Third\nFourth" });
  });

  test("quotes, figures, embeds, tables, code and footnotes", () => {
    const blocks = parseReaderText([
      "> Yes, there is still *enormous* uncertainty.\n> A second line.",
      "![A chart](https://example.org/c.png \"Figure 1: Demand\")",
      "[[IMAGE:https://example.org/d.png]]",
      "[[EMBED:https://x.com/someone/status/1]]",
      "| Year | Panels |\n|---|---:|\n| 2009 | 11 |",
      "```\nconst a = 1;\n```",
      "[^1]: Why is the *cybersecurity* community\n  so calm about it?",
    ].join("\n\n"));
    expect(blocks.map((block) => block.kind)).toEqual(["quote", "figure", "figure", "embed", "table", "code", "footnote"]);
    expect(blocks[0]?.text).toBe("Yes, there is still enormous uncertainty.\nA second line.");
    expect(blocks[1]).toMatchObject({ src: "https://example.org/c.png", alt: "A chart", text: "Figure 1: Demand" });
    expect(blocks[2]).toMatchObject({ src: "https://example.org/d.png", text: "" });
    expect(blocks[3]).toMatchObject({ href: "https://x.com/someone/status/1" });
    expect(blocks[4]?.text).toBe("Year | Panels\n2009 | 11");
    expect(blocks[5]).toMatchObject({ code: "const a = 1;" });
    expect(blocks[6]).toMatchObject({ label: "1", text: "Why is the cybersecurity community so calm about it?" });
  });

  test("plain text headings are preserved as paragraphs instead of guessing", () => {
    const blocks = parseReaderText("A short statement\n\nThe complete sentence continues here.");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
    expect(parseReaderText("## The C# example ##")[0]?.text).toBe("The C# example");
  });

  test("ids survive preceding insertions and remain unique for duplicates", () => {
    const original = parseReaderText("One complete paragraph.\n\nA second paragraph.");
    const expanded = parseReaderText("New introduction.\n\nOne complete paragraph.\n\nA second paragraph.\n\nOne complete paragraph.");
    expect(expanded[1]?.id).toBe(original[0]?.id);
    expect(expanded[2]?.id).toBe(original[1]?.id);
    expect(new Set(expanded.map((block) => block.id)).size).toBe(expanded.length);
  });

  test("ids of plain paragraphs match the ids older reader links used", () => {
    // The old parser hashed "paragraph:" plus the text. Plain text keeps its id.
    expect(parseReaderText("One complete paragraph.")[0]?.id).toBe("passage-f6b70q");
  });

  test("empty source text has no fabricated body", () => {
    expect(parseReaderText(null)).toEqual([]);
    expect(parseReaderText(" \r\n\t")).toEqual([]);
  });
});

describe("plain text for the pipeline", () => {
  test("strips markup, keeps image markers and footnotes, drops embeds", () => {
    const source = "## Title\n\nA [link](https://a.org) and *em*.[^1]\n\n1. One\n2. Two\n\n![x](https://a.org/i.png \"Cap\")\n\n[[EMBED:https://x.com/a]]\n\n[^1]: Note.";
    expect(plainText(source)).toBe("Title\n\nA link and em.\n\n1. One\n2. Two\n\n[[IMAGE:https://a.org/i.png]]\nCap\n\n[1] Note.");
  });

  test("every block's text appears in the plain text, so pipeline quotes match the reader", () => {
    const source = "Para with **bold** text.\n\n> A quoted line here.\n\n- item one\n- item two";
    const plain = plainText(source);
    for (const block of parseReaderText(source)) {
      for (const line of block.text.split("\n")) expect(plain).toContain(line);
    }
  });
});

describe("header repeated in the body", () => {
  test("leading title, subtitle and byline paragraphs are dropped", () => {
    const blocks = parseReaderText("A big-tent or small-tent AI safety movement?\n\nThe unstated disagreement that underpins safety debates\n\nArvind Narayanan and Sayash Kapoor · AI as Normal Technology · October 1, 2026\n\nThe real first paragraph.");
    const kept = withoutRepeatedHeader(blocks, [
      "A big-tent or small-tent AI safety movement?",
      "The unstated disagreement that underpins safety debates",
      "Arvind Narayanan and Sayash Kapoor · AI as Normal Technology · October 1, 2026",
    ]);
    expect(kept.map((block) => block.text)).toEqual(["The real first paragraph."]);
  });

  test("a body that does not repeat the header is untouched", () => {
    const blocks = parseReaderText("First.\n\nSecond.");
    expect(withoutRepeatedHeader(blocks, ["A title", null])).toEqual(blocks);
  });
});

describe("anchoring quotes to blocks", () => {
  test("matches across punctuation, markup and whitespace", () => {
    const blocks = parseReaderText("The first paragraph has no note.\n\nWe should consider *careful testing* before release.");
    const one = entry("one", { context_quote: "consider careful\n testing before release" });
    const result = mapQuotesToBlocks(blocks, [one], quoteOf);
    expect(result.byBlock.get(blocks[1]!.id)).toEqual([one]);
  });

  test("prefers updated wording and falls back to an unchanged context paragraph", () => {
    const blocks = parseReaderText("The old proposal required just one evaluation.\n\nThe new proposal requires three independent evaluations.\n\nA final paragraph records a different policy.");
    const updated = entry("updated", { updated_quote: "requires three independent evaluations", context_quote: "required just one evaluation" });
    const drifted = entry("drifted", { context_quote: "wording which is not present", context_paragraph: "A final paragraph records a different policy." });
    const result = mapQuotesToBlocks(blocks, [updated, drifted], quoteOf);
    expect(result.byBlock.get(blocks[1]!.id)).toEqual([updated]);
    expect(result.byBlock.get(blocks[2]!.id)).toEqual([drifted]);
  });

  test("does not misplace missing, short, ambiguous or quote-less entries", () => {
    const blocks = parseReaderText("We need careful testing before release.\n\nThey also need careful testing before release.\n\nThe subtotal evidence is inconclusive.");
    const entries = [
      entry("missing", { context_quote: "This sentence does not appear in this article." }),
      entry("short", { context_quote: "release" }),
      entry("repeated", { context_quote: "careful testing before release" }),
      entry("word-boundary", { context_quote: "total evidence is inconclusive" }),
      entry("none", null),
    ];
    const result = mapQuotesToBlocks(blocks, entries, quoteOf);
    expect(result.byBlock.size).toBe(0);
    expect(result.unanchored).toEqual(entries);
  });

  test("a selection widens to whole words and comes back beside the same passage", () => {
    const blocks = parseReaderText("First passage says one thing about pacing.\n\nSecond passage says the technology deprives nobody.\n\nThird passage repeats: the technology deprives nobody.");
    const second = blocks[1]!;
    expect(anchorForSelection(second, "chnology deprives nob")).toBe("technology deprives nobody.");
    expect(anchorForSelection(second, "too fast")).toBeNull();
    const anchor = anchorForSelection(second, "technology deprives nobody")!;
    const placed = mapQuotesToBlocks(blocks, [entry("n1", { context_quote: anchor, context_paragraph: second.text })], quoteOf);
    expect(placed.byBlock.get(second.id)?.map((e) => e.id)).toEqual(["n1"]);
  });
});

describe("marking quotes inside styled text", () => {
  test("marks merge per kind and split runs at their edges", () => {
    const runs = parseInline("Demand could *double* by 2035. Storage matters.");
    const text = runs.map((run) => run.text).join("");
    const marks = findQuoteMarks(text, [{ quote: "could double", kind: "note" }, { quote: "double by 2035.", kind: "note" }]);
    expect(marks).toEqual([{ start: 7, end: 28, kind: "note" }]);
    expect(markRuns(runs, marks)).toEqual([
      { text: "Demand " },
      { text: "could ", mark: "note" },
      { text: "double", em: true, mark: "note" },
      { text: " by 2035.", mark: "note" },
      { text: " Storage matters." },
    ]);
  });

  test("quote matching crosses line breaks and escapes regular expression punctuation", () => {
    expect(findQuoteMarks("A [50%]\nchance.", [{ quote: "[50%] chance.", kind: "key_point" }, { quote: " ", kind: "x" }]))
      .toEqual([{ start: 2, end: 15, kind: "key_point" }]);
  });
});
