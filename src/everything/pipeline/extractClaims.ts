/**
 * Claim extraction for the everything pipeline.
 *
 * The gate and split step (gateAndSplit.ts) first decides whether the text is
 * worth checking at all and cuts it into topic parts. We then ask the model,
 * with high thinking effort, to cut each chunk of a part into passages that add
 * up to the whole chunk, and to sort every passage as a statement that a
 * neutral expert could find misleading, a forecast or something else
 * (passages.ts reads the answer). The text is either a timestamped YouTube transcript or a plain
 * article. A passage of claims lists them in neutral, self-contained language,
 * and the passage itself is the verbatim excerpt that the claims sit in. How
 * true a claim is gets decided afterwards by the rating step in rateClaims.ts,
 * which has web access.
 *
 * A claim from a YouTube video has its context snapped back onto the subtitle
 * cues, which gives us a deep link into the video.
 *
 * An article's images are described by Gemini beforehand, both a description of
 * the image and the text read off it. Those descriptions are spliced into the
 * article as bracketed blocks, so extraction always runs on plain text.
 */

import PQueue from "p-queue";
import { trackLlmCall, trackedLlmCreate } from "../../pipeline/cost-tracking/costTracker";
import { ModelOutputInvalidError } from "../../pipeline/utils/errors";
import type { ChatMessage } from "../../pipeline/utils/jsonLlmCall";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";
import type { SubtitleCue } from "../../pipeline/media/youtubeCaptions";
import { describeImageFromUrl, type GeminiMediaDescription } from "../../pipeline/media/mediaAnalysisGemini";
import { IMAGE_MARKER_RE } from "../sources/substack";
import type { ClaimAnchor, ContentPart, ExtractedClaim, ExtractionResult, FetchedContent } from "../types";
import { normalizeText } from "../../everything-core/normalizeText";
import { cutCues, cutText, gateAndSplit, joinCues, type GateSplitVerdict, type PartStart } from "./gateAndSplit";
import { extractionModels } from "./model";
import { FORECAST_TYPE, MIN_COVERAGE, OTHER_TYPE, PASSAGE_TYPES, PassageFormatError, STATEMENT_TYPE, claimsOfPassages, describeProblems, hasTextOutsideImages, parsePassages, type Passage, type PassageClaim } from "./passages";

const PASSAGE_TYPE_DESCRIPTIONS: Record<(typeof PASSAGE_TYPES)[number], string> = {
  [STATEMENT_TYPE]: `a statement about the world where there is some chance that a neutral expert on its topic could find it misleading: false, out of date, overstated, missing context, cherry-picked, wrongly attributed or misleading in some other way. This covers facts, numbers, dates, events, quotations, attributions, causes, comparisons and things presupposed as background fact. When in doubt, choose this type. A sentence that mixes an opinion with a factual premise is also a statement. Also give "claims", as described below.`,
  [FORECAST_TYPE]: `says what will or might happen in the future: a prediction, a projection, a probability or a plan.`,
  [OTHER_TYPE]: `everything else: an opinion or value judgment with no factual premise, a recommendation, a joke, a question, a part of an invented story or an imagined scenario, a definition, and text with no content such as a heading, a transition, a greeting, a call to action, a list of links or a caption. Also give "why": a few words on what the passage is.`,
};

const PASSAGE_EXAMPLE_TEXT = `I think Berlin is the best city in Europe. It has a population of 3.7 million, and the Wall fell in 1989. By 2030 it will have 4 million people. Once upon a time a dragon lived in a cave under the Spree.`;
const PASSAGE_EXAMPLE_ANSWER = {
  "I think Berlin is the best city in Europe.": { type: OTHER_TYPE, why: "opinion" },
  "It has a population of 3.7 million,": { type: STATEMENT_TYPE, claims: ["Berlin has a population of 3.7 million."] },
  "and the Wall fell in 1989.": { type: STATEMENT_TYPE, claims: ["The Berlin Wall fell in 1989."] },
  "By 2030 it will have 4 million people.": { type: FORECAST_TYPE },
  "Once upon a time a dragon lived in a cave under the Spree.": { type: OTHER_TYPE, why: "invented story" },
};

/** `extraTypes` adds types to the usual four, for experiments that want to see
 *  which passages do not fit them. */
export function extractionSystemPrompt(extraTypes: Record<string, string> = {}): string {
  const types = Object.entries({ ...PASSAGE_TYPE_DESCRIPTIONS, ...extraTypes }).map(([name, description]) => `- "${name}": ${description}`);
  return `You cut a text into passages and sort every passage by what it says. The text is an excerpt of a podcast transcript or an article. It may contain bracketed image blocks: an "Image: <url>" line followed by "Description:" and/or "Visible text:" lines generated from that image. They are a text rendering of the image (you are not shown the image itself), not part of the prose.

The user message may begin with an "Introduction (context only):" block. It is the opening of the whole piece and is there so you understand what the part is about. Do not cut it into passages. Cut only the text after "Part:".

Cut the text into consecutive passages that together add up to all of it, word for word and in order. Leave nothing out and change nothing: no rewording, no fixing of typos. Do not include the label line at the start ("${ARTICLE_LABEL}" or "${TRANSCRIPT_LABEL}") or the image blocks. You may leave out the line breaks between passages. Make each passage as short as its content allows: normally one sentence, or several when a claim cannot stand without them. Cut between sentences, and inside a sentence only when its parts have different types.

Answer with one JSON object. Each key is one passage, copied from the text. Each value is an object whose FIRST key is "type", set to one of:
${types.join("\n")}

Statements must be as atomic as possible: a statement passage holds one statement, which a neutral expert could judge on its own. If a sentence holds two or more statements, cut inside the sentence so that each gets its own passage, for example at a comma, an "and", a "while" or a "which". Only when statements are woven into each other so that no cut can separate them, for example a description inside a sentence about something else, keep them in one passage and list each as a claim. Forecast and other passages do not have to be atomic: let them run as long as they naturally do.

"claims" is a list of the claims the passage makes or relies on, normally just one, including implicit ones. Write each claim in NEUTRAL, SELF-CONTAINED language: strip the author's rhetoric, framing, hedging and tone, and state the underlying factual proposition plainly, as a neutral third party would. Resolve pronouns and references so the claim stands entirely on its own, because each claim is fact-checked in isolation with NONE of the surrounding text, so it must carry all the context it needs (who, what, when, where).

A claim can rest on an image, for example data in a chart, a figure in a screenshot or what a photo depicts, which you read from the image block's Description and Visible text. For such a claim, add a key that is exactly the "Image: <url>" line of its block, with the type "${STATEMENT_TYPE}" and its "claims". An image with nothing to check gets no key.

Example text:
${PASSAGE_EXAMPLE_TEXT}

Example answer:
${JSON.stringify(PASSAGE_EXAMPLE_ANSWER, null, 1)}`;
}

/** Copies the claim of a passage onto an ExtractedClaim and attaches the anchor
 *  we resolved for it. */
function toExtractedClaim(raw: PassageClaim, anchor: ClaimAnchor): ExtractedClaim {
  return {
    claim: raw.claim,
    context: raw.context,
    contextParagraph: raw.contextParagraph,
    imageUrls: raw.imageUrls,
    veryConfidentTrue: false,
    speculation: false,
    anchor,
  };
}

// IMAGE_MARKER_RE is a shared global regex and keeps state between scans. So we
// always scan with a fresh clone of it.
const freshImageMarkerRe = () => new RegExp(IMAGE_MARKER_RE.source, "g");

/** Asks Gemini to describe every `[[IMAGE:url]]` in the article and returns the
 *  descriptions keyed by URL. Each distinct URL is described once, and the calls
 *  run in parallel. A description that fails becomes empty fields, and the
 *  renderer still keeps the URL in the text. */
export async function describeArticleImages(text: string): Promise<Map<string, GeminiMediaDescription>> {
  const urls = [...new Set([...text.matchAll(freshImageMarkerRe())].map((m) => m[1]!))];
  const entries = await Promise.all(
    urls.map((url, i) =>
      describeImageFromUrl(url, `everything.extract.image.${i}`)
        .then((item) => [url, item.description] as const)
        .catch((err) => {
          console.error(`[extractClaims] Image description failed (${url}):`, err.message);
          return [url, { description: "", ocrText: "" }] as const;
        }),
    ),
  );
  return new Map(entries);
}

/** Replaces each `[[IMAGE:url]]` marker with a bracketed block of text. The
 *  block holds the URL, so the model can cite it back in image_urls, plus
 *  Gemini's description and the text it read off the image. The brackets make
 *  the block read as an aside, so the model never quotes it as article prose. */
export function renderImageDescriptions(text: string, descriptions: Map<string, GeminiMediaDescription>): string {
  return text.replace(freshImageMarkerRe(), (_m, url) => {
    const { description, ocrText } = descriptions.get(url) ?? { description: "", ocrText: "" };
    const lines = [`Image: ${url}`];
    if (description) lines.push(`Description: ${description}`);
    if (ocrText) lines.push(`Visible text: ${ocrText}`);
    if (lines.length === 1) lines.push("(image could not be analyzed)");
    return `[${lines.join("\n")}]`;
  });
}

const MAX_PASSAGE_ATTEMPTS = 3;

export interface PassageExtraction {
  passages: Passage[];
  /** The share of the chunk's characters that the passages cover. */
  coverage: number;
  attempts: number;
}

/** One extraction over a rendered text chunk. The calls go through the tracked
 *  wrapper so their cost lands in the active cost tracker. For years they did
 *  not, which made the daily spend cap undercount by exactly the extraction
 *  spend.
 *
 *  The answer must be one JSON object whose passages add up to the chunk. A
 *  provider cannot enforce that, and the model now and then skips a stretch,
 *  rewords a passage or answers in prose. So the answer is checked, and when it
 *  falls short the model is told which text it left out and asks again. After
 *  three attempts the call throws, because passages that do not cover the text
 *  would silently lose claims.
 *
 *  `extraTypes` adds types for experiments. */
export async function runPassageExtraction(content: string, extraTypes: Record<string, string> = {}): Promise<PassageExtraction> {
  const body = bodyOfChunkMessage(content);
  if (!hasTextOutsideImages(body)) return { passages: [], coverage: 1, attempts: 0 };
  const allowedTypes = [...PASSAGE_TYPES, ...Object.keys(extraTypes)];
  const messages: ChatMessage[] = [
    { role: "system", content: extractionSystemPrompt(extraTypes) },
    { role: "user", content },
  ];
  let lastFeedback = "";
  for (let attempt = 1; attempt <= MAX_PASSAGE_ATTEMPTS; attempt++) {
    const callName = attempt === 1 ? "claim_extraction" : `claim_extraction.retry.${attempt - 1}`;
    const { model, reasoning } = extractionModels();
    const { response, costEntry } = await trackedLlmCreate(callName, {
      model,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort: reasoning.extraction,
    } as any);
    trackLlmCall(costEntry);
    const answer: string = (response as any).choices?.[0]?.message?.content ?? "{}";
    try {
      const parse = parsePassages(stripJsonFences(answer), body, allowedTypes);
      if (parse.coverage >= MIN_COVERAGE) return { passages: parse.passages, coverage: parse.coverage, attempts: attempt };
      lastFeedback = describeProblems(parse);
    } catch (err) {
      if (!(err instanceof PassageFormatError)) throw err;
      lastFeedback = `${err.message} Answer again with one JSON object in the format described.`;
    }
    messages.push({ role: "assistant", content: answer }, { role: "user", content: lastFeedback });
  }
  throw new ModelOutputInvalidError(`claim_extraction: no acceptable answer after ${MAX_PASSAGE_ATTEMPTS} attempts. ${lastFeedback}`);
}

/** The claims of one chunk, each with the passage it sits in. */
export async function runExtraction(content: string): Promise<PassageClaim[]> {
  const { passages } = await runPassageExtraction(content);
  return claimsOfPassages(passages, bodyOfChunkMessage(content));
}

function buildVideoLink(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}

/**
 * Returns the time span of a context excerpt: the earliest start and the latest
 * end among the cues the excerpt overlaps. The start on its own gives us the
 * deep link into the video. The start and end together give the bounds of the
 * clip. If the excerpt cannot be located in the cues, the returned object is
 * empty.
 *
 * We locate the excerpt in two ways. First we search for it as a substring of
 * the full transcript, built by joining all normalized cue texts. That finds
 * any verbatim excerpt, however short, even one that straddles a cue boundary.
 * If that fails, for example because the excerpt came from an author's own
 * transcript whose wording differs slightly from the cues, we fall back to
 * scanning for whole cues that appear inside the excerpt.
 */
const MIN_SNAP_MATCH_CHARS = 12;
export function contextTimeSpan(context: string, cues: SubtitleCue[]): { start?: number; end?: number } {
  const ctx = normalizeText(context);
  if (!ctx) return {};
  return joinedCueSpan(ctx, cues) ?? containedCueSpan(ctx, cues);
}

/** Finds the excerpt as a substring of the joined normalized cue texts and
 *  returns the span of the cues the match overlaps. Null when the excerpt does
 *  not appear verbatim. */
function joinedCueSpan(ctx: string, cues: SubtitleCue[]): { start: number; end: number } | null {
  const ranges: { from: number; to: number; cue: SubtitleCue }[] = [];
  let joined = "";
  for (const cue of cues) {
    const t = normalizeText(cue.text);
    if (!t) continue;
    if (joined) joined += " ";
    ranges.push({ from: joined.length, to: joined.length + t.length, cue });
    joined += t;
  }
  const at = joined.indexOf(ctx);
  if (at === -1) return null;
  const matchEnd = at + ctx.length;
  let start: number | undefined;
  let end: number | undefined;
  for (const r of ranges) {
    if (r.to <= at || r.from >= matchEnd) continue;
    if (start === undefined || r.cue.start < start) start = r.cue.start;
    if (end === undefined || r.cue.end > end) end = r.cue.end;
  }
  return start === undefined || end === undefined ? null : { start, end };
}

/** The original snapping: the span of the whole cues whose text appears inside
 *  the excerpt. Only an excerpt longer than a cue can match this way. */
function containedCueSpan(ctx: string, cues: SubtitleCue[]): { start?: number; end?: number } {
  let start: number | undefined;
  let end: number | undefined;
  for (const cue of cues) {
    const t = normalizeText(cue.text);
    if (t.length >= MIN_SNAP_MATCH_CHARS && ctx.includes(t)) {
      if (start === undefined || cue.start < start) start = cue.start;
      if (end === undefined || cue.end > end) end = cue.end;
    }
  }
  return { start, end };
}

// We split a long part into chunks because one giant call summarizes or
// samples the text instead of extracting every claim, and a smaller chunk
// keeps each call exhaustive. This holds for Muse as much as it did for Opus:
// on the Decker test item one call over 42,000 characters found 80 claims and
// four 12,000-character chunks found 336 (GOO-159, see
// src/scripts_jim/2026_09_14_muse_pipeline_comparison/RESULTS.md).
const EXTRACTION_CHUNK_CHARS = 12_000;

// This is the cue version of chunkText. It keeps every cue's timestamp.
function chunkCues(cues: SubtitleCue[]): SubtitleCue[][] {
  const chunks: SubtitleCue[][] = [];
  let cur: SubtitleCue[] = [];
  let curLen = 0;
  for (const cue of cues) {
    const lineLen = cue.text.length + 1;
    if (cur.length && curLen + lineLen > EXTRACTION_CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(cue);
    curLen += lineLen;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Splits a block that is larger than a whole chunk, preferring a newline and
 *  then a space near the boundary so words stay intact. Such a block comes
 *  from text with no blank lines at all, for example a web page whose fetch
 *  fell back to plain tag-stripping. Without this a single block would become
 *  one oversized extraction call. */
function splitOversizedBlock(block: string): string[] {
  const parts: string[] = [];
  let rest = block;
  while (rest.length > EXTRACTION_CHUNK_CHARS) {
    const window = rest.slice(0, EXTRACTION_CHUNK_CHARS);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > EXTRACTION_CHUNK_CHARS / 2 ? cut : EXTRACTION_CHUNK_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// We split on blank lines so that paragraphs and speaker turns stay intact.
export function chunkText(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).flatMap((block) => splitOversizedBlock(block));
  const chunks: string[] = [];
  let cur = "";
  for (const block of blocks) {
    if (cur && cur.length + block.length > EXTRACTION_CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + block.trim();
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** Resolves each claim's context excerpts to where they live in the source. */
type AnchorResolver = (context: string, contextParagraph: string) => ClaimAnchor;

/** Snaps a claim's context onto the video's cues and returns a YouTube anchor we
 *  can deep-link to. Two paths share this. A live YouTube video extracts its
 *  claims from the cues themselves. A transcript import extracts them from a
 *  supplied transcript, but the timestamps still come from the video's own
 *  cues. When the tight context excerpt cannot be located in the cues, we snap
 *  the wider paragraph instead — a looser clip, but the claim keeps its
 *  timestamp and the extension can still pin it on the player. */
function youtubeAnchor(videoId: string, cues: SubtitleCue[]): AnchorResolver {
  return (context, contextParagraph) => {
    let span = contextTimeSpan(context, cues);
    if (span.start === undefined) span = contextTimeSpan(contextParagraph, cues);
    const { start, end } = span;
    return {
      kind: "youtube",
      startSeconds: start,
      endSeconds: end,
      deepLinkUrl: start !== undefined ? buildVideoLink(videoId, start) : undefined,
    };
  };
}

/** Extract from pre-rendered chunks, then attach each claim's resolved anchor.
 *  The queue is shared across the parts of one item, so an item never runs more
 *  chunks at once than the caller allowed. */
async function extractChunks(
  renderedChunks: string[],
  anchorFor: AnchorResolver,
  queue: PQueue,
): Promise<ExtractedClaim[]> {
  const perChunk = await Promise.all(renderedChunks.map((chunk) => queue.add(() => runExtraction(chunk))));
  return perChunk
    .flat()
    .filter((c): c is PassageClaim => !!c)
    .map((c) => toExtractedClaim(c, anchorFor(c.context, c.contextParagraph)));
}

// The LLM sees plain transcript text with no timestamps in it. We snap the
// timestamps from the cues afterwards, so no [seconds] marker can leak into a
// claim's verbatim context.
const TRANSCRIPT_LABEL = "Transcript segment:";
const ARTICLE_LABEL = "Article excerpt:";
const transcriptChunk = (text: string) => `${TRANSCRIPT_LABEL}\n\n${text}`;
export const articleChunk = (text: string) => `${ARTICLE_LABEL}\n\n${text}`;

/** The user message for one chunk of a part. The introduction goes ahead of the
 *  chunk as context, labelled so the prompt's rule not to extract from it
 *  applies. The introduction's own part, and an unsplit item, send the chunk
 *  alone. */
function partUserMessage(introduction: string | null, chunk: string): string {
  return introduction ? `${INTRODUCTION_HEADER}\n\n${introduction}${PART_SEPARATOR}${chunk}` : chunk;
}

const INTRODUCTION_HEADER = "Introduction (context only):";
const PART_SEPARATOR = "\n\nPart:\n\n";

/** The text of a chunk message that the passages must add up to: what follows
 *  the introduction and the label line. */
export function bodyOfChunkMessage(message: string): string {
  const part = message.startsWith(INTRODUCTION_HEADER) ? message.lastIndexOf(PART_SEPARATOR) : -1;
  const chunk = part === -1 ? message : message.slice(part + PART_SEPARATOR.length);
  const label = [ARTICLE_LABEL, TRANSCRIPT_LABEL].find((l) => chunk.startsWith(`${l}\n\n`));
  return label ? chunk.slice(label.length + 2) : chunk;
}

/** One part ready to extract: its stored text, its rendered chunks, and how to
 *  anchor the claims found in them. */
interface PlannedPart {
  title: string;
  text: string;
  chunks: string[];
  anchorFor: AnchorResolver;
  /** False for the introduction's own part, which has nothing ahead of it. */
  withIntroduction: boolean;
}

const INTRODUCTION_TITLE = "Introduction";

/** Runs the gate and split call. When the gate is off, a not-checkable verdict
 *  is ignored and the text is treated as one part; a reader who asked for the
 *  page gets it checked whatever it is. */
async function gateAndSplitFor(text: string, title: string, gate: boolean): Promise<GateSplitVerdict> {
  const verdict = await gateAndSplit(text, title);
  if (verdict.kind === "not_checkable" && !gate) return { kind: "checkable", starts: [] };
  return verdict;
}

async function extractPlannedParts(
  introduction: string | null,
  planned: PlannedPart[],
  concurrency: number,
): Promise<ExtractionResult> {
  const queue = new PQueue({ concurrency });
  const parts: ContentPart[] = await Promise.all(
    planned.map(async (part, index) => ({
      index,
      title: part.title,
      text: part.text,
      claims: await extractChunks(
        part.chunks.map((chunk) => partUserMessage(part.withIntroduction ? introduction : null, chunk)),
        part.anchorFor,
        queue,
      ),
    })),
  );
  return { kind: "claims", introduction, parts };
}

/** Plans the parts of a text item. `render` turns a part's stored text into the
 *  text the model reads, which for an article means splicing in the image
 *  descriptions. */
function planTextParts(params: {
  title: string;
  text: string;
  starts: PartStart[];
  render: (partText: string) => string;
  chunkLabel: (chunk: string) => string;
  anchorFor: AnchorResolver;
}): { introduction: string | null; planned: PlannedPart[] } {
  const { starts, render, chunkLabel, anchorFor } = params;
  const chunksOf = (text: string) => chunkText(render(text)).map(chunkLabel);
  const cut = cutText(params.text, starts);
  if (!cut) {
    return {
      introduction: null,
      planned: [{ title: params.title, text: params.text, chunks: chunksOf(params.text), anchorFor, withIntroduction: false }],
    };
  }
  const planned: PlannedPart[] = [];
  if (cut.introduction) {
    planned.push({ title: INTRODUCTION_TITLE, text: cut.introduction, chunks: chunksOf(cut.introduction), anchorFor, withIntroduction: false });
  }
  for (const part of cut.parts) {
    planned.push({ title: part.title, text: part.text, chunks: chunksOf(part.text), anchorFor, withIntroduction: true });
  }
  return { introduction: cut.introduction, planned };
}

/** Plans the parts of a live YouTube video. A part is a range of whole cues,
 *  and its claims snap onto those cues only, so a phrase the speaker repeats
 *  resolves inside the right part. */
function planCueParts(params: {
  title: string;
  videoId: string;
  cues: SubtitleCue[];
  starts: PartStart[];
}): { introduction: string | null; planned: PlannedPart[] } {
  const { videoId, cues, starts } = params;
  const plan = (title: string, partCues: SubtitleCue[], withIntroduction: boolean): PlannedPart => ({
    title,
    text: joinCues(partCues),
    chunks: chunkCues(partCues).map((chunk) => transcriptChunk(joinCues(chunk))),
    anchorFor: youtubeAnchor(videoId, partCues),
    withIntroduction,
  });
  const cut = cutCues(cues, starts);
  if (!cut) return { introduction: null, planned: [plan(params.title, cues, false)] };
  const planned: PlannedPart[] = [];
  if (cut.introduction.length) planned.push(plan(INTRODUCTION_TITLE, cut.introduction, false));
  for (const part of cut.parts) planned.push(plan(part.title, part.cues, true));
  return { introduction: cut.introduction.length ? joinCues(cut.introduction) : null, planned };
}

/** Extracts the claims of one item. `gate` says whether a not-checkable verdict
 *  ends the item; it is off for pages a reader asked for. */
export async function extractClaims(content: FetchedContent, concurrency: number, gate = true): Promise<ExtractionResult> {
  switch (content.kind) {
    case "youtube": {
      const verdict = await gateAndSplitFor(joinCues(content.cues), content.title, gate);
      if (verdict.kind === "not_checkable") return verdict;
      const { introduction, planned } = planCueParts({ title: content.title, videoId: content.videoId, cues: content.cues, starts: verdict.starts });
      return extractPlannedParts(introduction, planned, concurrency);
    }
    case "youtube-transcript": {
      const verdict = await gateAndSplitFor(content.text, content.title, gate);
      if (verdict.kind === "not_checkable") return verdict;
      // The transcript's wording differs from the cues, so a text offset cannot
      // be mapped onto a cue range. Every part snaps against the full cue list.
      const { introduction, planned } = planTextParts({
        title: content.title,
        text: content.text,
        starts: verdict.starts,
        render: (text) => text,
        chunkLabel: transcriptChunk,
        anchorFor: youtubeAnchor(content.videoId, content.cues),
      });
      return extractPlannedParts(introduction, planned, concurrency);
    }
    case "substack": {
      const verdict = await gateAndSplitFor(content.text, content.title, gate);
      if (verdict.kind === "not_checkable") return verdict;
      // The images are described once for the whole article. Each part then
      // gets the descriptions spliced into its own text before chunking, so
      // the chunk budget counts the real description text rather than the
      // short markers.
      const descriptions = await describeArticleImages(content.text);
      const { introduction, planned } = planTextParts({
        title: content.title,
        text: content.text,
        starts: verdict.starts,
        render: (text) => renderImageDescriptions(text, descriptions),
        chunkLabel: articleChunk,
        anchorFor: () => ({ kind: "substack", url: content.url }),
      });
      return extractPlannedParts(introduction, planned, concurrency);
    }
  }
}

/**
 * Drops every claim about a hypothetical or future scenario. Only a claim about
 * the present or the past can be fact-checked, so speculation never reaches the
 * rest of the pipeline. Everything downstream works on the returned subset.
 */
export function dropSpeculation(claims: ExtractedClaim[]): ExtractedClaim[] {
  return claims.filter((c) => !c.speculation);
}
