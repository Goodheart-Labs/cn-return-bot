import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReaderText, plainText, type InlineRun, type ReaderBlock } from "../../everything-core/readerText";
import { htmlToReaderBlocks } from "./htmlToReaderText";
import bigTentPost from "./fixtures/big-tent-substack-post.json";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

function blockRuns(block: ReaderBlock): InlineRun[] {
  switch (block.kind) {
    case "list":
      return block.items.flat();
    case "table":
      return [...block.header, ...block.rows.flat()].flat();
    case "figure":
      return block.caption;
    case "embed":
    case "code":
      return [];
    default:
      return block.runs;
  }
}

const allRuns = (blocks: ReaderBlock[]) => blocks.flatMap(blockRuns);
const ofKind = <K extends ReaderBlock["kind"]>(blocks: ReaderBlock[], kind: K) =>
  blocks.filter((block): block is ReaderBlock & { kind: K } => block.kind === kind);

describe("the big-tent Substack post", () => {
  const blocks = parseReaderText(htmlToReaderBlocks(bigTentPost.body_html, bigTentPost.canonical_url).join("\n\n"));

  test("keeps its four section headings", () => {
    expect(ofKind(blocks, "heading").map((heading) => `${heading.level} ${heading.text}`)).toEqual([
      "3 It is true that we systematically underinvest in resilience against catastrophic and systemic risks",
      "3 The Coxon incident shows how the warped media environment elevates x-risk over more grounded concerns",
      "3 Why the x-risk framing may be counterproductive for AI safety policy",
      "3 Conclusion: a big tent or small tent AI safety movement?",
    ]);
  });

  test("keeps every link as an absolute web address", () => {
    const links = allRuns(blocks).filter((run) => run.href);
    // The post has 44 anchors. Eight of them are the footnotes' references and
    // their numbers, which become footnote markers instead of links.
    expect(links).toHaveLength(36);
    expect(links.every((run) => /^https:\/\//.test(run.href!))).toBe(true);
    expect(links[0]).toEqual({ text: "writing on AI safety", href: "https://www.normaltech.ai/p/the-ai-as-normal-technology-view" });
  });

  test("links each of its four footnotes both ways", () => {
    const references = allRuns(blocks).filter((run) => run.footnote).map((run) => run.footnote);
    const definitions = ofKind(blocks, "footnote");
    expect(references).toEqual(["1", "2", "3", "4"]);
    expect(definitions.map((footnote) => footnote.label)).toEqual(["1", "2", "3", "4"]);
    expect(definitions[0]!.text).toStartWith("Why is the cybersecurity community allergic");
    expect(blocks.slice(-4).every((block) => block.kind === "footnote")).toBe(true);
  });

  test("keeps the quote, the numbered list, the bullet list and the italics", () => {
    expect(ofKind(blocks, "quote").map((quote) => quote.text)).toEqual([
      "“Yes, there’s still enormous uncertainty about what the rest of our lives will look like, but as far as I can tell, there’s no longer any real uncertainty that it’ll all mostly revolve around AI, and the extent to which we succeed or fail at directing its power toward human flourishing.”",
    ]);
    const lists = ofKind(blocks, "list");
    expect(lists.map((list) => [list.ordered, list.start, list.items.length])).toEqual([[true, 1, 2], [false, 1, 3]]);
    expect(allRuns(blocks).filter((run) => run.em).map((run) => run.text)).toContain("counterproductive to AI safety");
    expect(lists[1]!.items[1]![0]).toEqual({ text: "Values and movement building.", strong: true });
  });

  test("starts with the article, not with its title, subtitle or byline", () => {
    expect(blocks[0]!.text).toStartWith("In recent weeks, two narratives about AI safety have emerged");
  });

  test("its plain text has no markup left in it", () => {
    const text = plainText(htmlToReaderBlocks(bigTentPost.body_html, bigTentPost.canonical_url).join("\n\n"));
    expect(text).not.toContain("\\");
    expect(text).not.toContain("](");
    expect(text).toContain("[1] Why is the cybersecurity community allergic");
  });
});

describe("a page with an image, embeds and a table", () => {
  const readerText = htmlToReaderBlocks(fixture("synthetic-article.html"), "https://example.com/posts/grid").join("\n\n");
  const blocks = parseReaderText(readerText);

  test("keeps the figure with its alt text and caption", () => {
    const [figure] = ofKind(blocks, "figure");
    expect(figure).toMatchObject({ src: "https://cdn.example.com/grid.png", alt: "A chart of grid demand", text: "Demand by year, from the “Grid Outlook” by Example Org" });
    expect(figure!.caption.at(-1)).toEqual({ text: "Example Org", href: "https://example.org/outlook" });
  });

  test("turns the tweet and the YouTube player into embed lines, and drops an embed without an address", () => {
    expect(ofKind(blocks, "embed").map((embed) => embed.href)).toEqual([
      "https://x.com/someone/status/123456789",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]);
  });

  test("keeps the table with its header row and an escaped pipe", () => {
    const [table] = ofKind(blocks, "table");
    expect(table!.header.map((cell) => cell.map((run) => run.text).join(""))).toEqual(["Year", "Demand (TWh)"]);
    expect(table!.rows[1]![1]).toEqual([{ text: "4,400", strong: true }, { text: " | est." }]);
  });

  test("keeps the list's start number and lists nested items as bullets after their parent", () => {
    expect(ofKind(blocks, "list").map((list) => [list.ordered, list.start, list.text])).toEqual([
      [true, 3, "Third, and most important.\nFourth, with details:"],
      [false, 1, "first detail\nsecond detail"],
      [true, 5, "Fifth, in bold italics."],
    ]);
    const [third] = ofKind(blocks, "list")[0]!.items;
    expect(third).toContainEqual({ text: "most", em: true, strong: true });
    expect(ofKind(blocks, "list")[2]!.items[0]![0]).toEqual({ text: "Fifth", em: true, strong: true });
  });

  test("escapes text the parser would read as markup", () => {
    const paragraphs = ofKind(blocks, "paragraph").map((paragraph) => paragraph.text);
    expect(paragraphs).toContain("1. This line starts like a numbered item, but it is a paragraph.");
    expect(paragraphs).toContain("# Neither is this a heading, and | this is not a table.");
    expect(paragraphs[0]).toEndWith("Some call it *the* boom, others use snake_case names like grid_load.");
  });

  test("resolves relative links and keeps a generic footnote", () => {
    expect(allRuns(blocks).find((run) => run.text === "rose sharply")?.href).toBe("https://example.com/data/demand");
    expect(ofKind(blocks, "footnote").map((footnote) => [footnote.label, footnote.text])).toEqual([["1", "The 2025 figure is an estimate."]]);
  });

  test("keeps the quote's paragraphs and the code block, and drops subscribe, button and share chrome", () => {
    expect(ofKind(blocks, "quote")[0]!.text).toBe("A quoted line.\n\nA second quoted paragraph with inline code.");
    expect(ofKind(blocks, "code")[0]!.code).toBe("const demand = load * 2;\nconsole.log(demand);");
    expect(readerText).not.toMatch(/Subscribe|Share|Expand/);
  });
});
