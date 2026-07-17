import { normalizeText } from "../../everything-shared/normalizeText";

/**
 * Quote → DOM-Range anchoring.
 *
 * Claim quotes are LLM-captured "verbatim" excerpts — near-verbatim in
 * practice (markdown artifacts, smart quotes, footnote markers), so exact
 * substring search over the page fails routinely. Instead both sides are
 * reduced with the shared normalizeText (lowercase, non-alphanumerics → space,
 * collapse) and matched in normalized space; a per-character index map carries
 * the match back to raw text offsets, and a binary search over the text-node
 * segments turns those into a Range.
 */

export interface TextIndex {
  /** Text nodes in document order with their start offset in the raw concat. */
  segments: { node: Text; start: number }[];
  norm: string;
  /** normToRaw[i] = offset in the raw concat of the char behind norm[i]. */
  normToRaw: number[];
}

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Walk the container's text nodes into one searchable normalized string. */
export function indexContainer(container: Element): TextIndex {
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.tagName) || parent.closest("[hidden]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: { node: Text; start: number }[] = [];
  let norm = "";
  const normToRaw: number[] = [];
  let rawLength = 0;
  // Raw offset of the first char of the currently open "gap" (a run of
  // non-alphanumerics that will collapse into a single space).
  let gapStart = -1;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    segments.push({ node, start: rawLength });
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      const lower = text[i]!.toLowerCase();
      const isAlnum = (lower >= "a" && lower <= "z") || (lower >= "0" && lower <= "9");
      if (isAlnum) {
        if (gapStart >= 0 && norm.length > 0) {
          norm += " ";
          normToRaw.push(gapStart);
        }
        gapStart = -1;
        norm += lower;
        normToRaw.push(rawLength + i);
      } else if (gapStart < 0) {
        gapStart = rawLength + i;
      }
    }
    // No forced gap at node boundaries: inline elements can split a word
    // mid-run (`foo<em>bar</em>` renders "foobar"), and block boundaries
    // almost always carry punctuation/whitespace that opens a gap anyway.
    rawLength += text.length;
  }

  return { segments, norm, normToRaw };
}

// Below this many normalized chars a quote is too generic to anchor safely.
const MIN_MATCH_CHARS = 12;
// textFragment.ts-style fallback: match the first/last EDGE_WORDS words when
// the middle of the quote has drifted from the rendered text.
const EDGE_WORDS = 6;
// The edge match's end must land within this factor of the quote's own length.
const EDGE_SLACK = 1.5;

function edgeMatch(norm: string, normQuote: string): { start: number; length: number } | null {
  const words = normQuote.split(" ");
  if (words.length <= EDGE_WORDS * 2) return null;
  const prefix = words.slice(0, EDGE_WORDS).join(" ");
  const suffix = words.slice(-EDGE_WORDS).join(" ");
  const start = norm.indexOf(prefix);
  if (start < 0) return null;
  const windowEnd = start + Math.ceil(normQuote.length * EDGE_SLACK);
  const suffixAt = norm.indexOf(suffix, start + prefix.length);
  if (suffixAt < 0 || suffixAt + suffix.length > windowEnd) return null;
  return { start, length: suffixAt + suffix.length - start };
}

/** Segment containing the raw offset (greatest start <= offset). */
function locate(segments: TextIndex["segments"], rawOffset: number): { node: Text; offset: number } {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.start <= rawOffset) lo = mid;
    else hi = mid - 1;
  }
  const seg = segments[lo]!;
  return { node: seg.node, offset: Math.min(rawOffset - seg.start, seg.node.data.length) };
}

/** Find a quote in the indexed container. Exact normalized match first, then
 *  the edge-words fallback. Null when the quote can't be located. */
export function findQuoteRange(index: TextIndex, quote: string): Range | null {
  if (index.segments.length === 0) return null;
  const normQuote = normalizeText(quote);
  if (normQuote.length < MIN_MATCH_CHARS) return null;

  let start = index.norm.indexOf(normQuote);
  let length = normQuote.length;
  if (start < 0) {
    const edge = edgeMatch(index.norm, normQuote);
    if (!edge) return null;
    ({ start, length } = edge);
  }

  const rawStart = index.normToRaw[start]!;
  const rawLast = index.normToRaw[start + length - 1]!;
  const doc = index.segments[0]!.node.ownerDocument;
  const range = doc.createRange();
  const s = locate(index.segments, rawStart);
  const e = locate(index.segments, rawLast);
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, Math.min(e.offset + 1, e.node.data.length));
  return range;
}
