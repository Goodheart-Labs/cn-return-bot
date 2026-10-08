/**
 * Finding a passage in a text, loosely: capitals and punctuation do not matter,
 * the way normalizeText sees a text. The dataset builder and the eval runner
 * both use it to find the chunk and the paragraph a datapoint sits in.
 */
import { normalizeText } from "../../../everything-core/normalizeText";

/** Words at each end of a passage used to find it. */
const WORDS_TO_LOCATE = 9;

function wordsOf(text: string, from: "start" | "end"): string[] {
  const words = normalizeText(text).split(" ");
  return from === "start" ? words.slice(0, WORDS_TO_LOCATE) : words.slice(-WORDS_TO_LOCATE);
}

/** A pattern that matches the words in the text however the punctuation and
 *  capitals between them differ. */
function looseMatcher(words: string[]): RegExp {
  return new RegExp(words.join("[^a-zA-Z0-9]+"), "i");
}

/** The offsets of a passage inside a text, or null when it is not there. */
export function locate(text: string, passage: string): { start: number; end: number } | null {
  const head = looseMatcher(wordsOf(passage, "start")).exec(text);
  if (!head) return null;
  const tailMatch = looseMatcher(wordsOf(passage, "end")).exec(text.slice(head.index));
  if (!tailMatch) return null;
  return { start: head.index, end: head.index + tailMatch.index + tailMatch[0].length };
}

/** The paragraphs (blank-line separated) the passage sits in. A passage that
 *  runs over several paragraphs gives all of them. */
export function paragraphsAround(text: string, passage: string): string | null {
  const span = locate(text, passage);
  if (!span) return null;
  const startOfParagraph = text.lastIndexOf("\n\n", span.start);
  const endOfParagraph = text.indexOf("\n\n", span.end);
  return text.slice(startOfParagraph === -1 ? 0 : startOfParagraph + 2, endOfParagraph === -1 ? text.length : endOfParagraph).trim();
}
