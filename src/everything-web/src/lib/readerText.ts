import { normalizeText } from "../../../everything-shared/normalizeText";
import type { NoteRow } from "../../../everything-shared/types";

/** Plain source wording plus just enough structure for a reading page. Keep the
 * original block too: rendering must never replace the author's words with a
 * claim extracted by the notes pipeline. */
export interface ReaderBlock {
  id: string;
  kind: "paragraph" | "heading" | "list";
  text: string;
  sourceText: string;
  level?: number;
  items?: string[];
  ordered?: boolean;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^ {0,3}([-+*]|\d+[.)])\s+(.+)$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;

/** Content-based ids survive inserting an earlier paragraph. Identical blocks
 * get a suffix so every fragment still names one element. */
function blockId(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return `passage-${(hash >>> 0).toString(36)}`;
}

export function parseReaderText(fullText: string | null | undefined): ReaderBlock[] {
  if (!fullText?.trim()) return [];
  const lines = fullText.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReaderBlock[] = [];
  const occurrences = new Map<string, number>();
  const add = (block: Omit<ReaderBlock, "id">) => {
    const base = blockId(`${block.kind}:${block.text}`);
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    blocks.push({ ...block, id: count === 1 ? base : `${base}-${count}` });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      add({ kind: "heading", level: heading[1]!.length, text: heading[2]!, sourceText: line });
      i++;
      continue;
    }

    const underline = lines[i + 1]?.match(SETEXT);
    if (underline && !LIST_ITEM.test(line)) {
      add({
        kind: "heading",
        level: underline[1]![0] === "=" ? 1 : 2,
        text: line.trim(),
        sourceText: `${line}\n${lines[i + 1]}`,
      });
      i += 2;
      continue;
    }

    const firstItem = line.match(LIST_ITEM);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[1]!);
      const sourceLines: string[] = [];
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const item = current.match(LIST_ITEM);
        if (item && /^\d/.test(item[1]!) === ordered) {
          sourceLines.push(current);
          items.push(item[2]!);
          i++;
        } else if (!item && /^\s{2,}\S/.test(current)) {
          // A wrapped list item stays with the item that introduced it.
          sourceLines.push(current);
          items[items.length - 1] += `\n${current.trimStart()}`;
          i++;
        } else {
          break;
        }
      }
      add({ kind: "list", text: items.join("\n"), sourceText: sourceLines.join("\n"), items, ordered });
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim()) {
      if (HEADING.test(lines[i]!) || LIST_ITEM.test(lines[i]!)) break;
      if (lines[i + 1] && SETEXT.test(lines[i + 1]!)) break;
      paragraph.push(lines[i]!);
      i++;
    }
    const text = paragraph.join("\n");
    add({ kind: "paragraph", text, sourceText: text });
  }
  return blocks;
}

interface BlockSpan {
  id: string;
  start: number;
  end: number;
}

interface Match {
  blockId: string;
  start: number;
  end: number;
}

/** The shared normalizer handles punctuation, smart quotes and whitespace.
 * Short, generic phrases are left unanchored instead of selecting a paragraph
 * on very little evidence. No fuzzy word-overlap score is used. */
function findMatches(text: string, spans: BlockSpan[], phrase: string | null): Match[] {
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
    // A quotation can cross a paragraph boundary. Attach it to the paragraph
    // that contains most of the matched passage; an equal split uses the first.
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

/** Every input note is returned once, either beside a supported passage or in
 * the unanchored list. The latter matters for image-only claims and quotations
 * whose source wording has changed. */
export function mapNotesToBlocks<T extends Pick<NoteRow, "claim">>(
  blocks: readonly ReaderBlock[],
  notes: readonly T[],
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

  for (const note of notes) {
    const claim = note.claim;
    let blockId: string | null = null;
    if (claim) {
      const context = findMatches(text, spans, claim.context_paragraph);
      for (const phrase of [claim.updated_quote, claim.context_quote]) {
        const matches = findMatches(text, spans, phrase);
        blockId = uniqueBlock(matches);
        if (!blockId && matches.length > 1 && context.length) {
          // The same quote may appear in an introduction and later in the
          // argument. Its surrounding paragraph can identify the intended one.
          blockId = uniqueBlock(matches.filter((match) => context.some(
            (paragraph) => match.start >= paragraph.start && match.end <= paragraph.end,
          )));
        }
        if (blockId) break;
      }
      blockId ??= uniqueBlock(context);
    }
    if (blockId) {
      const anchored = byBlock.get(blockId) ?? [];
      anchored.push(note);
      byBlock.set(blockId, anchored);
    } else {
      unanchored.push(note);
    }
  }
  return { byBlock, unanchored };
}

/** Drops the blocks at the very start whose every line repeats one of the
 *  given lines. The stored essay opens with its title and date, which the page
 *  already shows in the masthead, and the two may sit on adjacent lines and so
 *  form one block. Nothing after the first non-matching block is touched. */
export function stripLeadingBlocks(blocks: readonly ReaderBlock[], lines: readonly string[]): ReaderBlock[] {
  const wanted = new Set(lines.map((line) => normalizeText(line)));
  const repeats = (block: ReaderBlock) => block.text.split("\n").every((line) => wanted.has(normalizeText(line)));
  let from = 0;
  while (from < blocks.length && repeats(blocks[from]!)) from++;
  return blocks.slice(from);
}

/** Turns each line that is one of the given section titles into a heading.
 *  The stored text carries no heading markup, and the parser refuses to guess
 *  from shape, so the page names the sections it knows. A title that shares a
 *  paragraph with the lines around it, because no blank line separated them,
 *  splits that paragraph. Ids are rebuilt for every block this creates and
 *  never collide with the ids of the blocks left alone. */
export function promoteHeadings(blocks: readonly ReaderBlock[], titles: readonly string[]): ReaderBlock[] {
  const wanted = new Set(titles.map((title) => normalizeText(title)));
  const isTitle = (line: string) => wanted.has(normalizeText(line));
  const touched = (block: ReaderBlock) => block.kind === "paragraph" && block.text.split("\n").some(isTitle);
  const taken = new Set(blocks.filter((block) => !touched(block)).map((block) => block.id));
  const claim = (base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  const out: ReaderBlock[] = [];
  for (const block of blocks) {
    if (!touched(block)) {
      out.push(block);
      continue;
    }
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const text = run.join("\n");
      out.push({ kind: "paragraph", text, sourceText: text, id: claim(blockId(`paragraph:${text}`)) });
      run = [];
    };
    for (const line of block.text.split("\n")) {
      if (!isTitle(line)) {
        run.push(line);
        continue;
      }
      flush();
      const text = line.trim();
      out.push({ kind: "heading", level: 2, text, sourceText: line, id: claim(blockId(`heading:${text}`)) });
    }
    flush();
  }
  return out;
}

/** The anchor a reader's selection makes on a passage, or null when the
 *  selection is too short or is not in this passage. The selection is
 *  widened to whole words, and the length rule is the one findMatches
 *  applies, so an anchor accepted here is one that attaches to this passage
 *  when the note comes back from the database. Rendering wraps lines with
 *  pre-line, so a selection can carry newlines the stored text lacks and the
 *  other way round; both sides are compared with their whitespace collapsed. */
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
