import type { ReactNode } from "react";
import { findQuoteMarks, markRuns, runsText, type InlineRun, type QuoteMark, type ReaderBlock } from "@cn/core/readerText";

/** What kind of entry a mark in the text belongs to. Notes and reader
 *  highlights get different colours, so a reader can tell them apart. */
export type MarkKind = "note" | "highlight";

export const footnoteId = (scope: string, label: string) => `${scope}-fn-${label}`;
const footnoteRefId = (scope: string, label: string) => `${scope}-fnref-${label}`;

function Runs({ runs, marks, scope }: { runs: readonly InlineRun[]; marks: readonly QuoteMark[]; scope: string }) {
  return <>{markRuns(runs, marks).map((run, index) => {
    if (run.footnote) {
      return <sup key={index} className="reader-fnref"><a id={footnoteRefId(scope, run.footnote)} href={`#${footnoteId(scope, run.footnote)}`} aria-label={`Footnote ${run.footnote}`}>{run.footnote}</a></sup>;
    }
    let node: ReactNode = run.text;
    if (run.code) node = <code>{node}</code>;
    if (run.em) node = <em>{node}</em>;
    if (run.strong) node = <strong>{node}</strong>;
    if (run.href) node = <a href={run.href} target="_blank" rel="noopener noreferrer">{node}</a>;
    if (run.mark) node = <mark className={`reader-mark reader-mark-${run.mark}`} data-mark={run.mark}>{node}</mark>;
    return <span key={index}>{node}</span>;
  })}</>;
}

/** Marks for one stretch of runs. Quotes are matched against the runs' own
 *  text, so a quote spanning two list items marks neither, which is fine. */
function marksFor(runs: readonly InlineRun[], quotes: readonly { quote: string; kind: MarkKind }[]) {
  return quotes.length ? findQuoteMarks(runsText(runs), quotes) : [];
}

const EMBED_LABELS: [RegExp, string][] = [
  [/(^|\.)(x|twitter)\.com$/, "A post on X"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "A video on YouTube"],
  [/(^|\.)substack\.com$/, "A Substack post"],
];

function embedLabel(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./, "");
  return EMBED_LABELS.find(([pattern]) => pattern.test(host))?.[1] ?? `Embedded content from ${host}`;
}

/** One block of the article. `quotes` are the words to mark inside it. */
export function BlockContent({ block, quotes, scope }: { block: ReaderBlock; quotes: readonly { quote: string; kind: MarkKind }[]; scope: string }) {
  switch (block.kind) {
    case "heading": {
      const Heading = (`h${block.level}`) as "h2" | "h3" | "h4";
      return <Heading><Runs runs={block.runs} marks={marksFor(block.runs, quotes)} scope={scope} /></Heading>;
    }
    case "paragraph":
      return <p><Runs runs={block.runs} marks={marksFor(block.runs, quotes)} scope={scope} /></p>;
    case "quote":
      return <blockquote><Runs runs={block.runs} marks={marksFor(block.runs, quotes)} scope={scope} /></blockquote>;
    case "list": {
      const items = block.items.map((item, index) => <li key={index}><Runs runs={item} marks={marksFor(item, quotes)} scope={scope} /></li>);
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "figure":
      return <figure>
        <img src={block.src} alt={block.alt || runsText(block.caption)} loading="lazy" referrerPolicy="no-referrer" />
        {block.caption.length > 0 && <figcaption><Runs runs={block.caption} marks={marksFor(block.caption, quotes)} scope={scope} /></figcaption>}
      </figure>;
    case "embed":
      return <a className="reader-embed" href={block.href} target="_blank" rel="noopener noreferrer">
        <span>{embedLabel(block.href)}</span><span className="reader-embed-host">{new URL(block.href).hostname.replace(/^www\./, "")} ↗</span>
      </a>;
    case "table":
      return <div className="reader-table"><table>
        <thead><tr>{block.header.map((cell, index) => <th key={index}><Runs runs={cell} marks={[]} scope={scope} /></th>)}</tr></thead>
        <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Runs runs={cell} marks={[]} scope={scope} /></td>)}</tr>)}</tbody>
      </table></div>;
    case "code":
      return <pre><code>{block.code}</code></pre>;
    case "footnote":
      return <p className="reader-footnote" id={footnoteId(scope, block.label)}>
        <span className="reader-footnote-label">{block.label}.</span>{" "}
        <Runs runs={block.runs} marks={marksFor(block.runs, quotes)} scope={scope} />{" "}
        <a href={`#${footnoteRefId(scope, block.label)}`} aria-label={`Back to the text of footnote ${block.label}`}>↩</a>
      </p>;
  }
}
