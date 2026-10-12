import { normalizeText } from "./normalizeText";

/* Reader text is the format a minisite stores its article in
 * (everything_minisites.content). It is a small, strict subset of markdown:
 *
 *   ## Heading                  levels 2 to 4; a single # counts as level 2
 *   A paragraph with [a link](https://…), *emphasis*, **strong**, `code`
 *   and a footnote reference[^1].
 *   - bullet item               or "1. numbered item"; items may be separated by blank lines
 *   > a quote
 *   ![alt text](https://…/image.png "The caption")
 *   [[IMAGE:https://…]]         the pipeline's image marker, read as a figure without a caption
 *   [[EMBED:https://x.com/…]]   something the page embedded, shown as a link card
 *   | a | table |               a pipe table whose second line is the |---| separator
 *   ```                         a code block
 *   [^1]: The footnote's text.
 *
 * The same parser reads the plain full_text of older articles, which is why a
 * line it does not recognise is always kept as text instead of dropped.
 *
 * Every block also has a plain `text`: its words without any markup. Notes,
 * key points and selections are matched against that text, and plainText()
 * builds the article's text for the pipeline from the same pieces, so a quote
 * the pipeline picks always matches what the reader shows. */

/** A stretch of inline text with one set of styles. A footnote reference has
 *  empty `text`, so it never takes part in quote matching. */
export interface InlineRun {
  text: string;
  em?: boolean;
  strong?: boolean;
  code?: boolean;
  href?: string;
  footnote?: string;
}

interface BlockBase {
  id: string;
  /** The words without markup. Quotes and selections are matched against it. */
  text: string;
}

export type ReaderBlock = BlockBase & (
  | { kind: "paragraph" | "quote"; runs: InlineRun[] }
  | { kind: "heading"; level: 2 | 3 | 4; runs: InlineRun[] }
  | { kind: "list"; ordered: boolean; start: number; items: InlineRun[][] }
  | { kind: "figure"; src: string; alt: string; caption: InlineRun[] }
  | { kind: "embed"; href: string }
  | { kind: "table"; header: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: "code"; code: string }
  | { kind: "footnote"; label: string; runs: InlineRun[] }
);

export type ReaderBlockKind = ReaderBlock["kind"];

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const LIST_ITEM = /^ {0,3}([-+*]|\d{1,9}[.)])\s+(.+)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const FIGURE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/;
const IMAGE_MARKER = /^\[\[IMAGE:(\S+?)\]\]$/;
const EMBED_MARKER = /^\[\[EMBED:(\S+?)\]\]$/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:\s*(.*)$/;
const FENCE = /^ {0,3}```/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Only web addresses become links or images. Anything else stays text. */
function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// Content-based ids keep passage links stable when earlier paragraphs change.
function hashId(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `passage-${(hash >>> 0).toString(36)}`;
}

export const runsText = (runs: readonly InlineRun[]): string => runs.map((run) => run.text).join("");

type Style = Pick<InlineRun, "em" | "strong" | "href">;

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);

/** Finds the closing delimiter of an emphasis span that opened at `from`. */
function closingDelimiter(text: string, from: number, delimiter: string): number {
  for (let i = from; i <= text.length - delimiter.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (!text.startsWith(delimiter, i)) continue;
    if (/\s/.test(text[i - 1] ?? " ")) continue;
    // An underscore inside a word (snake_case) never closes emphasis.
    if (delimiter === "_" && isWordChar(text[i + 1])) continue;
    if (delimiter === "*" && text[i + 1] === "*") { i++; continue; }
    return i;
  }
  return -1;
}

/** Parses inline markup into runs. Unclosed or unknown markup stays text. */
export function parseInline(text: string, style: Style = {}): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, ...style });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    const rest = text.slice(i);

    if (char === "\\" && /[\\`*_[\]()#>!|.+-]/.test(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        runs.push({ text: text.slice(i + 1, end), code: true, ...style });
        i = end + 1;
        continue;
      }
    }

    const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
    if (footnote) {
      flush();
      runs.push({ text: "", footnote: footnote[1] });
      i += footnote[0].length;
      continue;
    }

    const link = /^\[((?:[^\]\\]|\\.)+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(rest);
    if (link && !style.href) {
      const href = webUrl(link[2]!);
      if (href) {
        flush();
        runs.push(...parseInline(link[1]!, { ...style, href }));
        i += link[0].length;
        continue;
      }
    }

    if (rest.startsWith("**") && text[i + 2] && !/\s/.test(text[i + 2]!)) {
      const end = closingDelimiter(text, i + 2, "**");
      if (end > i + 2) {
        flush();
        runs.push(...parseInline(text.slice(i + 2, end), { ...style, strong: true }));
        i = end + 2;
        continue;
      }
    }

    if ((char === "*" || char === "_") && text[i + 1] && !/\s/.test(text[i + 1]!) && !(char === "_" && isWordChar(text[i - 1]))) {
      const end = closingDelimiter(text, i + 1, char);
      if (end > i + 1) {
        flush();
        runs.push(...parseInline(text.slice(i + 1, end), { ...style, em: true }));
        i = end + 1;
        continue;
      }
    }

    buffer += char;
    i++;
  }
  flush();
  return runs;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

type Draft = ReaderBlock extends infer B ? B extends ReaderBlock ? Omit<B, "id"> : never : never;

/** Splits reader text into blocks. Empty input gives no blocks. */
export function parseReaderText(source: string | null | undefined): ReaderBlock[] {
  if (!source?.trim()) return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReaderBlock[] = [];
  const occurrences = new Map<string, number>();
  const add = (draft: Draft) => {
    const base = hashId(`${draft.kind}:${draft.kind === "figure" ? draft.src : draft.kind === "embed" ? draft.href : draft.text}`);
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    blocks.push({ ...draft, id: count === 1 ? base : `${base}-${count}` } as ReaderBlock);
  };
  const textBlock = (kind: "paragraph" | "quote", raw: string) => {
    const runs = parseInline(raw);
    add({ kind, runs, text: runsText(runs) });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      const code = body.join("\n");
      add({ kind: "code", code, text: code });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const runs = parseInline(heading[2]!);
      const level = Math.min(4, Math.max(2, heading[1]!.length)) as 2 | 3 | 4;
      add({ kind: "heading", level, runs, text: runsText(runs) });
      i++;
      continue;
    }

    const underline = lines[i + 1]?.match(SETEXT);
    if (underline && !LIST_ITEM.test(line) && !QUOTE.test(line)) {
      const runs = parseInline(trimmed);
      add({ kind: "heading", level: underline[1]![0] === "=" ? 2 : 3, runs, text: runsText(runs) });
      i += 2;
      continue;
    }

    const figure = FIGURE.exec(trimmed);
    const marker = IMAGE_MARKER.exec(trimmed);
    if (figure || marker) {
      const src = webUrl((figure?.[2] ?? marker?.[1])!);
      if (src) {
        const caption = parseInline(figure?.[3] ?? "");
        add({ kind: "figure", src, alt: figure?.[1] ?? "", caption, text: runsText(caption) });
        i++;
        continue;
      }
    }

    const embed = EMBED_MARKER.exec(trimmed);
    const embedHref = embed && webUrl(embed[1]!);
    if (embedHref) {
      add({ kind: "embed", href: embedHref, text: "" });
      i++;
      continue;
    }

    const definition = FOOTNOTE_DEF.exec(trimmed);
    if (definition) {
      const body = [definition[2]!];
      i++;
      while (i < lines.length && (/^\s{2,}\S/.test(lines[i]!) || (!lines[i]!.trim() && /^\s{2,}\S/.test(lines[i + 1] ?? "")))) {
        body.push(lines[i]!.trim());
        i++;
      }
      const runs = parseInline(body.filter(Boolean).join(" "));
      add({ kind: "footnote", label: definition[1]!, runs, text: runsText(runs) });
      continue;
    }

    if (trimmed.includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      const header = splitTableRow(line).map((cell) => parseInline(cell));
      const rows: InlineRun[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitTableRow(lines[i]!).map((cell) => parseInline(cell)));
        i++;
      }
      const text = [header, ...rows].map((row) => row.map(runsText).join(" | ")).join("\n");
      add({ kind: "table", header, rows, text });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1]!);
      textBlock("quote", body.join("\n").trim());
      continue;
    }

    const firstItem = LIST_ITEM.exec(line);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[1]!);
      const start = ordered ? parseInt(firstItem[1]!, 10) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const item = LIST_ITEM.exec(current);
        if (item && /^\d/.test(item[1]!) === ordered) {
          items.push(item[2]!);
          i++;
        } else if (!item && current.trim() && /^\s{2,}\S/.test(current)) {
          items[items.length - 1] += `\n${current.trim()}`;
          i++;
        } else if (!current.trim()) {
          // A blank line between two items of the same kind keeps one list.
          let next = i + 1;
          while (next < lines.length && !lines[next]!.trim()) next++;
          const following = LIST_ITEM.exec(lines[next] ?? "");
          if (!following || /^\d/.test(following[1]!) !== ordered) break;
          i = next;
        } else {
          break;
        }
      }
      const parsed = items.map((item) => parseInline(item));
      add({ kind: "list", ordered, start, items: parsed, text: parsed.map(runsText).join("\n") });
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim()) {
      const next = lines[i]!;
      if (HEADING.test(next) || LIST_ITEM.test(next) || QUOTE.test(next) || FENCE.test(next) || FOOTNOTE_DEF.test(next.trim())) break;
      if (lines[i + 1] && SETEXT.test(lines[i + 1]!)) break;
      paragraph.push(next);
      i++;
    }
    textBlock("paragraph", paragraph.join("\n"));
  }
  return blocks;
}

/** The article's text for the pipeline: the same words the reader shows, with
 *  markup removed, images as [[IMAGE:url]] markers and footnotes as "[1] …".
 *  Embeds carry no words and are left out. */
export function plainText(source: string): string {
  return parseReaderText(source).map((block) => {
    switch (block.kind) {
      case "list":
        return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : "-"} ${runsText(item)}`).join("\n");
      case "figure":
        return [`[[IMAGE:${block.src}]]`, block.text].filter(Boolean).join("\n");
      case "footnote":
        return `[${block.label}] ${block.text}`;
      case "embed":
        return "";
      default:
        return block.text;
    }
  }).filter(Boolean).join("\n\n");
}

/** Leading paragraphs that only repeat the header (title, description or
 *  byline) are dropped. Older articles were stored with their header as the
 *  first lines of the body, which showed the title twice. */
export function withoutRepeatedHeader(blocks: ReaderBlock[], header: (string | null | undefined)[]): ReaderBlock[] {
  const known = new Set(header.filter((value): value is string => !!value?.trim()).map(normalizeText));
  let skip = 0;
  while (skip < blocks.length && skip < 4) {
    const block = blocks[skip]!;
    const words = normalizeText(block.text);
    const repeats = (block.kind === "paragraph" || block.kind === "heading") && words
      && [...known].some((value) => value === words || (words.length > 20 && value.includes(words)) || (value.length > 20 && words.includes(value) && words.length < value.length * 2));
    if (!repeats) break;
    skip++;
  }
  return blocks.slice(skip);
}

interface BlockSpan { id: string; start: number; end: number }
interface Match { blockId: string; start: number; end: number }

// Short, generic phrases do not provide enough evidence to anchor a claim.
function findMatches(text: string, spans: BlockSpan[], phrase: string | null | undefined): Match[] {
  const normalized = normalizeText(phrase ?? "");
  if (normalized.length < 12 || normalized.split(" ").length < 3) return [];
  const matches: Match[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(normalized, from);
    if (start < 0) break;
    const end = start + normalized.length;
    from = start + 1;
    if ((start > 0 && text[start - 1] !== " ") || (end < text.length && text[end] !== " ")) continue;
    // Cross-paragraph quotes belong beside their largest overlap.
    let best: BlockSpan | undefined;
    let overlap = 0;
    for (const span of spans) {
      const amount = Math.min(end, span.end) - Math.max(start, span.start);
      if (amount > overlap) {
        overlap = amount;
        best = span;
      }
    }
    if (best) matches.push({ blockId: best.id, start, end });
  }
  return matches;
}

function uniqueBlock(matches: Match[]): string | null {
  const ids = new Set(matches.map((match) => match.blockId));
  return ids.size === 1 ? matches[0]!.blockId : null;
}

/** What anchoring needs from a note, a key point or a claim. */
export interface AnchorQuote {
  context_quote: string | null;
  context_paragraph: string | null;
  updated_quote?: string | null;
}

/** Places each entry beside the block its quote comes from. Entries whose
 *  quote cannot be found unambiguously stay reachable in `unanchored`. */
export function mapQuotesToBlocks<T>(
  blocks: readonly ReaderBlock[],
  entries: readonly T[],
  quoteOf: (entry: T) => AnchorQuote | null,
): { byBlock: Map<string, T[]>; unanchored: T[] } {
  let text = "";
  const spans = blocks.map((block): BlockSpan => {
    if (text) text += " ";
    const start = text.length;
    text += normalizeText(block.text);
    return { id: block.id, start, end: text.length };
  });
  const byBlock = new Map<string, T[]>();
  const unanchored: T[] = [];

  for (const entry of entries) {
    const quote = quoteOf(entry);
    let blockId: string | null = null;
    if (quote) {
      const context = findMatches(text, spans, quote.context_paragraph);
      for (const phrase of [quote.updated_quote, quote.context_quote]) {
        const matches = findMatches(text, spans, phrase);
        blockId = uniqueBlock(matches);
        if (!blockId && matches.length > 1 && context.length) {
          // Surrounding context can distinguish repeated quotations.
          blockId = uniqueBlock(matches.filter((match) => context.some(
            (paragraph) => match.start >= paragraph.start && match.end <= paragraph.end,
          )));
        }
        if (blockId) break;
      }
      blockId ??= uniqueBlock(context);
    }
    if (blockId) byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), entry]);
    else unanchored.push(entry);
  }
  return { byBlock, unanchored };
}

// Selections must meet the same matching rules as notes read back from storage.
export function anchorForSelection(block: Pick<ReaderBlock, "text">, selected: string): string | null {
  const passage = block.text.replace(/\s+/g, " ");
  const wanted = selected.replace(/\s+/g, " ").trim();
  if (!wanted) return null;
  let start = passage.indexOf(wanted);
  if (start < 0) return null;
  let end = start + wanted.length;
  while (start > 0 && passage[start - 1] !== " ") start--;
  while (end < passage.length && passage[end] !== " ") end++;
  const anchor = passage.slice(start, end).trim();
  const normalized = normalizeText(anchor);
  if (normalized.length < 12 || normalized.split(" ").length < 3) return null;
  return anchor;
}

/** A stretch of a block's text marked by a quote. */
export interface QuoteMark { start: number; end: number; kind: string }

/** Finds where each quote occurs in `text`, matching across any whitespace.
 *  Overlapping marks of the same kind merge into one. */
export function findQuoteMarks(text: string, quotes: readonly { quote: string; kind: string }[]): QuoteMark[] {
  const spans: QuoteMark[] = [];
  for (const { quote, kind } of quotes) {
    if (!quote.trim()) continue;
    const pattern = quote.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    for (const match of text.matchAll(new RegExp(pattern, "g"))) {
      spans.push({ start: match.index, end: match.index + match[0].length, kind });
    }
  }
  const merged: QuoteMark[] = [];
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && previous.kind === span.kind && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** A run cut to a mark's boundaries, with the mark's kind when inside one. */
export type MarkedRun = InlineRun & { mark?: string };

/** Splits runs at the boundaries of the marks, which are offsets into
 *  runsText(runs). Footnote references take no room. */
export function markRuns(runs: readonly InlineRun[], marks: readonly QuoteMark[]): MarkedRun[] {
  if (!marks.length) return [...runs];
  const out: MarkedRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    if (!run.text) { out.push(run); continue; }
    const cuts = new Set([runStart, runEnd]);
    for (const mark of marks) {
      if (mark.start > runStart && mark.start < runEnd) cuts.add(mark.start);
      if (mark.end > runStart && mark.end < runEnd) cuts.add(mark.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let p = 0; p < points.length - 1; p++) {
      const from = points[p]!;
      const to = points[p + 1]!;
      const mark = marks.find((m) => m.start <= from && m.end >= to);
      out.push({ ...run, text: run.text.slice(from - runStart, to - runStart), ...(mark ? { mark: mark.kind } : {}) });
    }
  }
  return out;
}
