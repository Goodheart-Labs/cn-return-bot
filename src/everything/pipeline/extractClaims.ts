/**
 * Claim extraction for the everything pipeline.
 *
 * We ask Opus, with high thinking effort, to extract every checkable claim from
 * a text. The text is either a timestamped YouTube transcript or a plain
 * article. Each claim comes back in neutral, self-contained language, with a
 * verbatim excerpt of the context around it and a truth judgement on a
 * seven-point scale that Opus makes from its own knowledge.
 *
 * A claim from a YouTube video has its context snapped back onto the subtitle
 * cues, which gives us a deep link into the video.
 *
 * An article's images are described by Gemini beforehand, both a description of
 * the image and the text read off it. Those descriptions are spliced into the
 * article as bracketed blocks, so extraction always runs on plain text.
 */

import PQueue from "p-queue";
import { llm } from "../../pipeline/llm/llm";
import { jsonSchemaResponseFormat } from "../../pipeline/prompts/responseFormat";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";
import type { SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import { describeImageFromUrl, type GeminiMediaDescription } from "../../pipeline/media/mediaAnalysisGemini";
import { IMAGE_MARKER_RE } from "../sources/substack";
import type { ClaimAnchor, ExtractedClaim, FetchedContent } from "../types";
import { normalizeText } from "../../everything-shared/normalizeText";

const CLAIM_EXTRACTION_MODEL = "anthropic/claude-opus-4.6";

// The list runs from most true to most false. A judgement's index in it decides
// whether the claim gets fact-checked.
export const JUDGEMENTS = [
  "certainly true",
  "likely true",
  "somewhat likely true",
  "uncertain",
  "somewhat likely false",
  "likely false",
  "certainly false",
] as const;

// We only fact-check a claim Opus is not confident about, so "uncertain" and
// everything below it.
const FACT_CHECK_FROM = JUDGEMENTS.indexOf("uncertain");
export function shouldFactCheck(judgement: string): boolean {
  const idx = (JUDGEMENTS as readonly string[]).indexOf(judgement);
  return idx === -1 || idx >= FACT_CHECK_FROM; // A judgement we do not recognize is checked to be safe.
}

function extractionSystemPrompt(): string {
  const fields = [
    `- "claim": the neutral, self-contained statement.`,
    `- "context": a verbatim excerpt from the text around the claim — its sentence plus enough surrounding sentences that a reader with none of the rest of the text has all the context needed to evaluate it. Verbatim source prose only — never quote an image block's Description/Visible text lines. Leave empty ("") for a claim grounded only in an image.`,
    `- "context_paragraph": a wider verbatim excerpt — the full surrounding paragraph(s) the claim sits in — that contains the "context" excerpt above word-for-word. Shown to readers as the broader passage around the highlighted claim. Same rule: verbatim source prose only. Leave empty ("") when there is no surrounding text.`,
    `- "image_urls": the URLs (from the "Image:" line of each image block) of any images the claim is based on — a chart, screenshot, photo, or diagram. Empty array for a text-only claim.`,
    `- "judgement": how true the claim is, using only your own knowledge — one of: ${JUDGEMENTS.join(", ")}.`,
    `- "speculation": true if the claim describes a hypothetical or future scenario — something stated as happening in a future year (e.g. "in 2028...") as part of an imagined scenario; false if it is about the present or past (2026 or earlier) or the current state of the world (real events, statistics, and any other real-world claim).`,
  ];
  return `You extract checkable factual claims from a text (podcast transcript or article). The text may contain bracketed image blocks — an "Image: <url>" line followed by "Description:" and/or "Visible text:" lines generated from that image. They are a text rendering of the image (you are not shown the image itself), not part of the article prose.

Extract EVERY distinct claim the text makes or relies on, including implicit ones — things presented as background fact or presupposed, not only what is stated outright. This includes claims carried by the images: data in a chart, a figure in a screenshot, what a photo depicts — read these from the image block's Description and Visible text. Split compound statements into separate claims.

A claim can rest on text, an image, or both. Ground each claim in what actually supports it: fill "context" from the article text and/or "image_urls" from the image blocks.

Write each claim in NEUTRAL, SELF-CONTAINED language:
- Strip the author's rhetoric, framing, hedging, and tone — state the underlying factual proposition plainly, as a neutral third party would.
- Resolve pronouns and references so the claim stands entirely on its own. Each claim is fact-checked in isolation with NONE of the surrounding text, so it must carry all the context it needs (who, what, when, where).

Skip pure opinion, value judgments, predictions, jokes, and anything not falsifiable.

For each claim return:
${fields.join("\n")}`;
}

function claimsResponseFormat() {
  const properties: Record<string, unknown> = {
    claim: { type: "string", description: "Neutral, self-contained restatement of the claim." },
    context: { type: "string", description: "Verbatim excerpt around the claim, or \"\" for an image-only claim." },
    context_paragraph: { type: "string", description: "Wider verbatim excerpt containing the context excerpt word-for-word, or \"\" when there is no surrounding text." },
    image_urls: { type: "array", items: { type: "string" }, description: "URLs of images the claim is based on; empty for a text-only claim." },
    judgement: { type: "string", enum: [...JUDGEMENTS], description: "How true the claim is, from your own knowledge." },
    speculation: { type: "boolean", description: "True if the claim is about a hypothetical/future scenario; false if about the present or past." },
  };
  const required = ["claim", "context", "context_paragraph", "image_urls", "judgement", "speculation"];
  return jsonSchemaResponseFormat("content_claims", {
    type: "object",
    properties: { claims: { type: "array", items: { type: "object", properties, required, additionalProperties: false } } },
    required: ["claims"],
    additionalProperties: false,
  });
}

interface RawClaim {
  claim: string;
  judgement: string;
  context: string;
  context_paragraph: string;
  image_urls?: string[];
  speculation: boolean;
}

/** Copies the LLM's claim fields onto an ExtractedClaim and attaches the anchor
 *  we resolved for it. */
function toExtractedClaim(raw: RawClaim, anchor: ClaimAnchor): ExtractedClaim {
  return {
    claim: raw.claim,
    judgement: raw.judgement,
    context: raw.context ?? "",
    contextParagraph: raw.context_paragraph ?? "",
    imageUrls: raw.image_urls ?? [],
    speculation: raw.speculation,
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
async function describeArticleImages(text: string): Promise<Map<string, GeminiMediaDescription>> {
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
function renderImageDescriptions(text: string, descriptions: Map<string, GeminiMediaDescription>): string {
  return text.replace(freshImageMarkerRe(), (_m, url) => {
    const { description, ocrText } = descriptions.get(url) ?? { description: "", ocrText: "" };
    const lines = [`Image: ${url}`];
    if (description) lines.push(`Description: ${description}`);
    if (ocrText) lines.push(`Visible text: ${ocrText}`);
    if (lines.length === 1) lines.push("(image could not be analyzed)");
    return `[${lines.join("\n")}]`;
  });
}

/** One Opus extraction call over a rendered text chunk. */
async function runExtraction(content: string): Promise<RawClaim[]> {
  const response: any = await llm.create({
    model: CLAIM_EXTRACTION_MODEL,
    messages: [
      { role: "system", content: extractionSystemPrompt() },
      { role: "user", content },
    ],
    response_format: claimsResponseFormat(),
    reasoning_effort: "high",
  } as any);
  const content2 = response.choices?.[0]?.message?.content ?? "{}";
  return (JSON.parse(stripJsonFences(content2)) as { claims: RawClaim[] }).claims ?? [];
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

// We split a long text into chunks for two reasons. One giant call tends to
// summarize or sample the text instead of extracting every claim, so a smaller
// chunk keeps each call exhaustive. Smaller calls also stay under the model's
// output token limit.
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
function chunkText(text: string): string[] {
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

/** Extract from pre-rendered chunks, then attach each claim's resolved anchor. */
async function extractChunks(
  renderedChunks: string[],
  anchorFor: AnchorResolver,
  concurrency: number,
): Promise<ExtractedClaim[]> {
  const queue = new PQueue({ concurrency });
  const perChunk = await Promise.all(renderedChunks.map((chunk) => queue.add(() => runExtraction(chunk))));
  return perChunk
    .flat()
    .filter((c): c is RawClaim => !!c)
    .map((c) => toExtractedClaim(c, anchorFor(c.context ?? "", c.context_paragraph ?? "")));
}

// The LLM sees plain transcript text with no timestamps in it. We snap the
// timestamps from the cues afterwards, so no [seconds] marker can leak into a
// claim's verbatim context.
const transcriptChunk = (text: string) => `Transcript segment:\n\n${text}`;

export async function extractClaims(content: FetchedContent, concurrency: number): Promise<ExtractedClaim[]> {
  switch (content.kind) {
    case "youtube":
      return extractChunks(
        chunkCues(content.cues).map((chunk) => transcriptChunk(chunk.map((c) => c.text).join("\n"))),
        youtubeAnchor(content.videoId, content.cues),
        concurrency,
      );
    case "youtube-transcript":
      return extractChunks(
        chunkText(content.text).map(transcriptChunk),
        youtubeAnchor(content.videoId, content.cues),
        concurrency,
      );
    case "substack": {
      // We describe the images first and only then chunk the rendered text.
      // That way the chunk budget counts the real description text rather than
      // the short markers.
      const descriptions = await describeArticleImages(content.text);
      return extractChunks(
        chunkText(renderImageDescriptions(content.text, descriptions)).map((chunk) => `Article excerpt:\n\n${chunk}`),
        () => ({ kind: "substack", url: content.url }),
        concurrency,
      );
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
