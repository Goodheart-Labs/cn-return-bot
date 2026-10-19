/** A paragraph longer than this is not a real paragraph. It comes from text
 *  without blank lines, such as a YouTube transcript, whose cues are joined by
 *  single line breaks. */
const MAX_PARAGRAPH_LENGTH = 3000;

/** How much text on each side of the selection stands in for the paragraph
 *  when the page has no usable paragraph breaks. */
const CONTEXT_AROUND_SELECTION = 1000;

const PARAGRAPH_BREAK = /\n\s*\n/g;

/** The paragraph a reader's selection sits in, taken word for word from the
 *  page text. A selection that crosses paragraph breaks gets every paragraph
 *  it touches. The selection is matched ignoring differences in whitespace,
 *  because the words a browser copies out of a page rarely keep its line
 *  breaks. When the words are not on the page at all, the selection itself is
 *  the best context we have, so it is returned unchanged. */
export function paragraphAround(pageText: string, selection: string): string {
  const span = locateSelection(pageText, selection);
  if (!span) return selection;
  const paragraph = paragraphBounds(pageText, span);
  if (paragraph.end - paragraph.start <= MAX_PARAGRAPH_LENGTH) return pageText.slice(paragraph.start, paragraph.end).trim();
  const start = wordStart(pageText, Math.max(paragraph.start, span.start - CONTEXT_AROUND_SELECTION));
  const end = wordEnd(pageText, Math.min(paragraph.end, span.end + CONTEXT_AROUND_SELECTION));
  return pageText.slice(start, end).trim();
}

type Span = { start: number; end: number };

function locateSelection(pageText: string, selection: string): Span | null {
  const words = selection.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const match = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(pageText);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paragraphBounds(pageText: string, span: Span): Span {
  let start = 0;
  let end = pageText.length;
  for (const paragraphBreak of pageText.matchAll(PARAGRAPH_BREAK)) {
    const breakStart = paragraphBreak.index;
    const breakEnd = breakStart + paragraphBreak[0].length;
    if (breakEnd <= span.start) start = breakEnd;
    else if (breakStart >= span.end) {
      end = breakStart;
      break;
    }
  }
  return { start, end };
}

function wordStart(text: string, index: number): number {
  while (index > 0 && !/\s/.test(text[index - 1]!)) index--;
  return index;
}

function wordEnd(text: string, index: number): number {
  while (index < text.length && !/\s/.test(text[index]!)) index++;
  return index;
}
