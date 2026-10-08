/**
 * The passage format of claim extraction. The model cuts a chunk of text into
 * consecutive passages that add up to the whole chunk, and sorts each passage
 * by what it says. It answers with one JSON object. Each key is a passage,
 * copied word for word, and each value is an object whose first key is the
 * passage's type. A passage that makes claims also lists them.
 *
 * This file reads that answer. It checks that the passages really add up to the
 * text, reports what is missing, and turns the passages into claims. It makes
 * no model call.
 */

/** A passage is a statement that a neutral expert could find misleading, a
 *  forecast, or anything else. Only a statement lists claims. */
export const STATEMENT_TYPE = "statement";
export const FORECAST_TYPE = "forecast";
export const OTHER_TYPE = "other";
export const PASSAGE_TYPES = [STATEMENT_TYPE, FORECAST_TYPE, OTHER_TYPE] as const;
export type PassageType = (typeof PASSAGE_TYPES)[number];

/** The share of the text's characters (spaces left out) that the passages must
 *  cover for an answer to be accepted. A little can go missing, such as a stray
 *  symbol, without making the whole chunk worthless. */
export const MIN_COVERAGE = 0.97;

const IMAGE_KEY_PREFIX = "Image: ";
/** The most characters of one missing piece of text that is quoted back to the model. */
const MAX_QUOTED_GAP_CHARS = 100;
const MAX_REPORTED_PROBLEMS = 5;
const WORDS_TO_MATCH_LOOSELY = 9;

/** The answer has the wrong shape, so the model has to answer again. */
export class PassageFormatError extends Error {}

export interface Passage {
  /** The passage as the text holds it, or the "Image: <address>" line for an image. */
  text: string;
  type: string;
  claims: string[];
  /** Where the passage sits in the text. Null for an image, and for a passage that was not found. */
  span: { start: number; end: number } | null;
  imageUrl: string | null;
  /** The rest of the value, such as a reason the model gave. */
  extra: Record<string, unknown>;
}

export interface PassageParse {
  passages: Passage[];
  /** Keys that could not be found in the text, usually because the model reworded them. */
  unmatched: string[];
  /** Stretches of the text that no passage covers. */
  uncovered: { start: number; end: number; text: string }[];
  /** The share of the text's characters that the passages cover. */
  coverage: number;
}

export interface PassageClaim {
  claim: string;
  /** The passage the claim sits in. Empty for a claim that rests on an image. */
  context: string;
  /** The paragraph around the passage, which the code adds. */
  contextParagraph: string;
  imageUrls: string[];
}

/** The keys of the top-level object of a JSON text, in the order they were
 *  written, repeated keys included. JSON.parse cannot give this: it moves keys
 *  that look like whole numbers to the front and merges repeated keys. A passage
 *  can be just a number, or appear twice, and the order is how the passages are
 *  matched to the text. */
export function topLevelKeys(json: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let expectKey = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (ch === '"') {
      let end = i + 1;
      while (end < json.length && json[end] !== '"') end += json[end] === "\\" ? 2 : 1;
      if (depth === 1 && expectKey) keys.push(JSON.parse(json.slice(i, end + 1)));
      expectKey = false;
      i = end;
    } else if (ch === "{" || ch === "[") {
      depth++;
      expectKey = depth === 1 && ch === "{";
    } else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 1) expectKey = true;
  }
  return keys;
}

/** The stretches of the text that are image blocks. The extractor reads an image
 *  as a bracketed block of lines, and a bracket inside the description does not
 *  end it: only a bracket that ends a line does. */
export function imageSpans(body: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const start = body.indexOf("[Image: ", from);
    if (start === -1) return spans;
    const lineEnd = body.indexOf("]\n", start);
    const end = lineEnd !== -1 ? lineEnd + 1 : body.endsWith("]") ? body.length : start + "[Image: ".length;
    spans.push({ start, end });
    from = end;
  }
}

/** Whether the text has anything besides image blocks and spaces. A chunk that has
 *  nothing else is not sent to the model. */
export function hasTextOutsideImages(body: string): boolean {
  let rest = body;
  for (const span of imageSpans(body).reverse()) rest = rest.slice(0, span.start) + rest.slice(span.end);
  return charsWithoutSpaces(rest) > 0;
}

function charsWithoutSpaces(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** A pattern that finds a passage by its words however the punctuation, capitals
 *  and spacing between them differ. */
function wordPattern(words: string[]): RegExp {
  return new RegExp(words.join("[^a-zA-Z0-9]+"), "i");
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

/** Finds a key in the text at or after `from`: word for word, otherwise by its
 *  words, where its first and last words give the two ends. */
function findKey(body: string, key: string, from: number): { start: number; end: number } | null {
  const exact = body.indexOf(key, from);
  if (exact !== -1) return { start: exact, end: exact + key.length };
  const words = wordsOf(key);
  if (words.length === 0) return null;
  const rest = body.slice(from);
  const head = wordPattern(words.slice(0, WORDS_TO_MATCH_LOOSELY)).exec(rest);
  if (!head) return null;
  const tail = wordPattern(words.slice(-WORDS_TO_MATCH_LOOSELY)).exec(rest.slice(head.index));
  if (!tail) return null;
  return extendOverPunctuation(body, from, from + head.index, from + head.index + tail.index + tail[0].length);
}

/** A match by words stops at the first and last word. The marks that touch them,
 *  such as a full stop or a quotation mark, belong to the passage too. */
function extendOverPunctuation(body: string, floor: number, start: number, end: number): { start: number; end: number } {
  const isMark = (ch: string | undefined) => ch !== undefined && /[^\w\s]/.test(ch);
  while (start > floor && isMark(body[start - 1])) start--;
  while (end < body.length && isMark(body[end])) end++;
  return { start, end };
}

function readPassage(key: string, value: unknown, allowedTypes: readonly string[]): Passage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PassageFormatError(`The value of the passage "${key.slice(0, 60)}" must be an object.`);
  const { type, claims, ...extra } = value as Record<string, unknown>;
  if (typeof type !== "string" || !allowedTypes.includes(type)) {
    throw new PassageFormatError(`The passage "${key.slice(0, 60)}" has the type ${JSON.stringify(type)}. The type must be one of: ${allowedTypes.map((t) => `"${t}"`).join(", ")}.`);
  }
  let listed: string[] = [];
  if (type === STATEMENT_TYPE) {
    const valid = Array.isArray(claims) && claims.length > 0 && claims.every((c) => typeof c === "string" && c.trim() !== "");
    if (!valid) throw new PassageFormatError(`The passage "${key.slice(0, 60)}" has the type "${type}", so it needs "claims": a list of one or more claims as strings.`);
    listed = claims as string[];
  }
  const isImage = key.startsWith(IMAGE_KEY_PREFIX);
  return { text: key, type, claims: listed, span: null, imageUrl: isImage ? key.slice(IMAGE_KEY_PREFIX.length).trim() : null, extra };
}

/** Reads the model's answer for a chunk of text, whose words the passages must
 *  add up to. Throws PassageFormatError when the answer has the wrong shape. A
 *  gap in the coverage is not an error here, it is reported for the caller to
 *  judge. */
export function parsePassages(raw: string, body: string, allowedTypes: readonly string[] = PASSAGE_TYPES): PassageParse {
  let object: unknown;
  try {
    object = JSON.parse(raw);
  } catch {
    throw new PassageFormatError("The answer is not valid JSON.");
  }
  if (!object || typeof object !== "object" || Array.isArray(object) || Object.keys(object).length === 0) {
    throw new PassageFormatError("The answer must be one JSON object with a key for every passage.");
  }
  const values = object as Record<string, unknown>;
  const images = imageSpans(body);
  const passages: Passage[] = [];
  const unmatched: string[] = [];
  const uncovered: PassageParse["uncovered"] = [];
  let cursor = 0;

  const noteGap = (start: number, end: number) => {
    if (end <= start) return;
    let text = "";
    let at = start;
    for (const image of images.filter((s) => s.end > start && s.start < end)) {
      text += body.slice(at, Math.max(at, image.start));
      at = Math.max(at, image.end);
    }
    text += body.slice(at, end);
    if (charsWithoutSpaces(text) > 0) uncovered.push({ start, end, text: text.trim() });
  };

  for (const key of topLevelKeys(raw)) {
    const passage = readPassage(key, values[key], allowedTypes);
    if (passage.imageUrl !== null) {
      if (body.includes(IMAGE_KEY_PREFIX + passage.imageUrl)) passages.push(passage);
      else unmatched.push(key);
      continue;
    }
    const found = findKey(body, key, cursor);
    if (!found) {
      unmatched.push(key);
      passages.push(passage);
      continue;
    }
    noteGap(cursor, found.start);
    cursor = found.end;
    passages.push({ ...passage, span: found });
  }
  noteGap(cursor, body.length);

  const total = charsWithoutSpaces(body) - images.reduce((sum, s) => sum + charsWithoutSpaces(body.slice(s.start, s.end)), 0);
  const missing = uncovered.reduce((sum, gap) => sum + charsWithoutSpaces(gap.text), 0);
  return { passages, unmatched, uncovered, coverage: total > 0 ? Math.max(0, 1 - missing / total) : 1 };
}

/** What to tell the model when its passages do not add up to the text. */
export function describeProblems(parse: PassageParse): string {
  const quote = (text: string) => JSON.stringify(text.length > MAX_QUOTED_GAP_CHARS ? text.slice(0, MAX_QUOTED_GAP_CHARS) + "..." : text);
  const lines = ["Your passages do not add up to the text."];
  if (parse.uncovered.length) lines.push(`These stretches of the text are in no passage: ${parse.uncovered.slice(0, MAX_REPORTED_PROBLEMS).map((g) => quote(g.text)).join("; ")}.`);
  if (parse.unmatched.length) lines.push(`These keys are not in the text word for word, in this order: ${parse.unmatched.slice(0, MAX_REPORTED_PROBLEMS).map(quote).join("; ")}.`);
  lines.push("Answer again with the whole JSON object. Copy every passage word for word, in the order of the text, and leave nothing out.");
  return lines.join(" ");
}

/** The paragraph, or paragraphs, around a passage. Paragraphs are separated by a blank line. */
export function paragraphAround(body: string, span: { start: number; end: number }): string {
  const before = body.lastIndexOf("\n\n", span.start);
  const after = body.indexOf("\n\n", span.end);
  return body.slice(before === -1 ? 0 : before + 2, after === -1 ? body.length : after).trim();
}

/** The claims of the passages, each with the passage it sits in and the paragraph
 *  around it. A claim that rests on an image has no passage and no paragraph. */
export function claimsOfPassages(passages: Passage[], body: string): PassageClaim[] {
  return passages
    .filter((p) => p.type === STATEMENT_TYPE)
    .flatMap((p) =>
      p.claims.map((claim) => ({
        claim,
        context: p.imageUrl ? "" : p.text,
        contextParagraph: p.imageUrl || !p.span ? "" : paragraphAround(body, p.span),
        imageUrls: p.imageUrl ? [p.imageUrl] : [],
      })),
    );
}
