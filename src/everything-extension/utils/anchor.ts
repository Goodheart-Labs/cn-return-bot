import { normalizeText } from "../../everything-shared/normalizeText";

/**
 * Anchoring a claim's quote to a DOM Range.
 *
 * A claim's quote is an excerpt an LLM captured as verbatim, but in practice it
 * is only close to verbatim. Markdown artifacts, smart quotes, and footnote
 * markers all creep in. So searching the page for the quote as a plain
 * substring fails routinely.
 * Instead both the page and the quote are reduced with the shared normalizeText
 * helper, which lowercases the text, turns every non-alphanumeric character
 * into a space, and collapses runs of spaces. The match is then found in that
 * normalized text. A per-character index maps the match back to offsets in the
 * raw text, and a binary search over the text-node segments turns those offsets
 * into a Range.
 */

export interface TextIndex {
  /** The text nodes in document order, each with its start offset in the
   *  concatenated raw text. */
  segments: { node: Text; start: number }[];
  norm: string;
  /** normToRaw[i] is the offset in the concatenated raw text of the character
   *  behind norm[i]. */
  normToRaw: number[];
}

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

// This is the value of NodeFilter.SHOW_TEXT, written out because the
// NodeFilter global does not exist outside a real browser. Under bun test with
// linkedom it is missing.
const SHOW_TEXT = 0x4;

// The skip check runs inside the walk loop rather than as a TreeWalker filter,
// because linkedom, which the tests run on, ignores filter callbacks.
function isSkipped(node: Text): boolean {
  const parent = node.parentElement;
  return !parent || SKIPPED_TAGS.has(parent.tagName) || !!parent.closest("[hidden]");
}

/** Walk the container's text nodes into one searchable normalized string. */
export function indexContainer(container: Element): TextIndex {
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, SHOW_TEXT);

  const segments: { node: Text; start: number }[] = [];
  let norm = "";
  const normToRaw: number[] = [];
  let rawLength = 0;
  // The raw offset of the first character of the gap that is currently open. A
  // gap is a run of non-alphanumeric characters that collapses into a single
  // space.
  let gapStart = -1;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (isSkipped(node)) continue;
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
    // We do not force a gap at a node boundary. An inline element can split a
    // word in the middle, so `foo<em>bar</em>` renders as "foobar". A block
    // boundary almost always carries punctuation or whitespace that opens a
    // gap by itself.
    rawLength += text.length;
  }

  return { segments, norm, normToRaw };
}

// A quote with fewer normalized characters than this is too generic to anchor
// safely.
const MIN_MATCH_CHARS = 12;
// A fallback for when the middle of the quote has drifted from the rendered
// text. We then match only the first and last EDGE_WORDS words. This is the
// approach textFragment.ts takes.
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

/** The segment that contains the raw offset. That is the segment with the
 *  greatest start offset that is not past it. */
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

export interface QuoteMatch {
  start: { node: Text; offset: number };
  /** The position of the match's last character. This position is
   *  inclusive. */
  end: { node: Text; offset: number };
}

/** Find a quote in the indexed container. An exact match on the normalized text
 *  is tried first, then the edge-words fallback. This returns null when the
 *  quote cannot be located. */
export function findQuoteMatch(index: TextIndex, quote: string): QuoteMatch | null {
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

  return {
    start: locate(index.segments, index.normToRaw[start]!),
    end: locate(index.segments, index.normToRaw[start + length - 1]!),
  };
}

/** The same as findQuoteMatch, but returned as a live DOM Range. */
export function findQuoteRange(index: TextIndex, quote: string): Range | null {
  const match = findQuoteMatch(index, quote);
  if (!match) return null;
  const range = match.start.node.ownerDocument.createRange();
  range.setStart(match.start.node, match.start.offset);
  range.setEnd(match.end.node, Math.min(match.end.offset + 1, match.end.node.data.length));
  return range;
}
