/**
 * Claim extraction for the everything pipeline.
 *
 * Ask Opus (high thinking) to extract every checkable claim from a text —
 * a timestamped YouTube transcript or a plain article — in neutral,
 * self-contained language, each with a verbatim context excerpt and a 7-point
 * truth judgement from its own knowledge. YouTube claims get their context
 * snapped back to subtitle cues for a deep link into the video. Article images
 * are pre-described by Gemini (description + OCR) and spliced inline as
 * bracketed text blocks, so extraction runs on plain text.
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

// Ordered most-true → most-false; the index drives which claims get fact-checked.
export const JUDGEMENTS = [
  "certainly true",
  "likely true",
  "somewhat likely true",
  "uncertain",
  "somewhat likely false",
  "likely false",
  "certainly false",
] as const;

// Only fact-check claims Opus isn't confident are true: "uncertain" and below.
const FACT_CHECK_FROM = JUDGEMENTS.indexOf("uncertain");
export function shouldFactCheck(judgement: string): boolean {
  const idx = (JUDGEMENTS as readonly string[]).indexOf(judgement);
  return idx === -1 || idx >= FACT_CHECK_FROM; // unknown / error judgement → check to be safe
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

/** Carry the LLM's claim fields onto an ExtractedClaim, attaching its resolved anchor. */
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

// IMAGE_MARKER_RE is a shared stateful global regex — always scan with a fresh clone.
const freshImageMarkerRe = () => new RegExp(IMAGE_MARKER_RE.source, "g");

/** Gemini-describe every `[[IMAGE:url]]` in the article once (deduped, in
 *  parallel), keyed by URL. A failed describe maps to empty fields — the
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

/** Replace each `[[IMAGE:url]]` marker with a bracketed text block: the URL (so
 *  the model can cite it into image_urls) plus the Gemini description and OCR.
 *  Bracketed so it reads as an aside, never as quotable article prose. */
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
 * Time span of a context excerpt: the earliest start and latest end among the
 * cues whose text falls inside the (verbatim) context. start → deep-link,
 * [start, end] → clip bounds. Returns {} when nothing lines up.
 */
const MIN_SNAP_MATCH_CHARS = 12;
function contextTimeSpan(context: string, cues: SubtitleCue[]): { start?: number; end?: number } {
  const ctx = normalizeText(context);
  if (!ctx) return {};
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

// Long texts are chunked so each Opus call stays exhaustive (one giant call
// tends to summarize/sample rather than extract every claim) and to dodge
// output-token limits.
const EXTRACTION_CHUNK_CHARS = 12_000;

// Cue version of chunkText: preserves timestamps per cue.
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

// Split on blank lines so paragraphs / speaker turns stay intact.
function chunkText(text: string): string[] {
  const blocks = text.split(/\n\s*\n/);
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

/** Resolves each claim's context excerpt to where it lives in the source. */
type AnchorResolver = (context: string) => ClaimAnchor;

/** Snap the context against the video's cues → deep-linkable YouTube anchor.
 *  Shared by live YouTube (extract from cues) and transcript imports (extract
 *  from a supplied transcript, timestamps still from the video's own cues). */
function youtubeAnchor(videoId: string, cues: SubtitleCue[]): AnchorResolver {
  return (context) => {
    const { start, end } = contextTimeSpan(context, cues);
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
    .map((c) => toExtractedClaim(c, anchorFor(c.context)));
}

// Plain transcript text for the LLM — timestamps are snapped from cues
// afterwards, so no [seconds] markers leak into the verbatim context.
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
      // Describe images up front, then chunk the rendered text — so the chunk
      // budget counts the actual description text, not the short markers.
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
 * Drop hypothetical/future-scenario claims: only real-world (present/past)
 * claims are fact-checkable, so speculation never reaches the rest of the
 * pipeline. Downstream works with the returned subset.
 */
export function dropSpeculation(claims: ExtractedClaim[]): ExtractedClaim[] {
  return claims.filter((c) => !c.speculation);
}
