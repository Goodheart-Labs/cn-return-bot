import { parseReaderText, type InlineRun, type ReaderBlock } from "../../everything-core/readerText";

/** Every inline run of a block, wherever in the block it sits. */
export function blockRuns(block: ReaderBlock): InlineRun[] {
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

/** How much of each kind of content a piece of reader text kept. The minisite
 *  script prints it, so a page that lost its links or headings stands out. */
export function readerTextStats(content: string) {
  const blocks = parseReaderText(content);
  const countOf = (kind: ReaderBlock["kind"]) => blocks.filter((block) => block.kind === kind).length;
  return {
    headings: countOf("heading"),
    links: blocks.flatMap(blockRuns).filter((run) => run.href).length,
    footnotes: countOf("footnote"),
    figures: countOf("figure"),
    embeds: countOf("embed"),
    quotes: countOf("quote"),
    lists: countOf("list"),
    tables: countOf("table"),
  };
}
