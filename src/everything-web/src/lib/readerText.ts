import { normalizeText } from "@cn/core/normalizeText";
import type { NoteRow } from "@cn/core/types";

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

// Content-based IDs keep passage links stable when earlier paragraphs change.
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

// Short, generic phrases do not provide enough evidence to anchor a claim.
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

// Unmatched notes must remain accessible, including image-only claims.
export function mapNotesToBlocks<T extends { claim: Pick<NoteRow["claim"], "context_quote" | "context_paragraph" | "updated_quote"> | null }>(
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
          // Surrounding context can distinguish repeated quotations.
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

export function highlightedTextParts(text: string, quotes: string[]): { text: string; highlighted: boolean }[] {
  const spans: { start: number; end: number }[] = [];
  for (const quote of quotes) {
    if (!quote.trim()) continue;
    const pattern = quote.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    for (const match of text.matchAll(new RegExp(pattern, "g"))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  const merged: typeof spans = [];
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  const parts: { text: string; highlighted: boolean }[] = [];
  let start = 0;
  for (const span of merged) {
    if (span.start > start) parts.push({ text: text.slice(start, span.start), highlighted: false });
    parts.push({ text: text.slice(span.start, span.end), highlighted: true });
    start = span.end;
  }
  if (start < text.length) parts.push({ text: text.slice(start), highlighted: false });
  return parts;
}
