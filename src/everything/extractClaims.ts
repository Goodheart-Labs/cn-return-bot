/**
 * Claim extraction for the everything pipeline.
 *
 * Ask Opus (high thinking) to extract every checkable claim from a text —
 * a timestamped YouTube transcript or a plain article — in neutral,
 * self-contained language, each with a verbatim context excerpt and a 7-point
 * truth judgement from its own knowledge. YouTube claims get their context
 * snapped back to subtitle cues for a deep link into the video.
 */

import PQueue from "p-queue";
import { llm } from "../pipeline/llm/llm";
import { jsonSchemaResponseFormat } from "../pipeline/prompts/responseFormat";
import { stripJsonFences } from "../pipeline/utils/jsonOutput";
import type { SubtitleCue } from "../pipeline/media/ytDlpDownload";
import type { ExtractedClaim, FetchedContent } from "./types";

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
    `- "context": a verbatim excerpt from the text around the claim — its sentence plus enough surrounding sentences that a reader with none of the rest of the text has all the context needed to evaluate it.`,
    `- "judgement": how true the claim is, using only your own knowledge — one of: ${JUDGEMENTS.join(", ")}.`,
  ];
  return `You extract checkable factual claims from a text (podcast transcript or article).

Extract EVERY distinct claim the text makes or relies on, including implicit ones — things presented as background fact or presupposed, not only what is stated outright. Split compound statements into separate claims.

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
    context: { type: "string", description: "Verbatim excerpt around the claim, with all the context needed to evaluate it." },
    judgement: { type: "string", enum: [...JUDGEMENTS], description: "How true the claim is, from your own knowledge." },
  };
  const required = ["claim", "context", "judgement"];
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
}

/** One Opus extraction call over a rendered text chunk. */
async function runExtraction(textForLlm: string): Promise<RawClaim[]> {
  const response: any = await llm.create({
    model: CLAIM_EXTRACTION_MODEL,
    messages: [
      { role: "system", content: extractionSystemPrompt() },
      { role: "user", content: textForLlm },
    ],
    response_format: claimsResponseFormat(),
    reasoning_effort: "high",
  } as any);
  const content = response.choices?.[0]?.message?.content ?? "{}";
  return (JSON.parse(stripJsonFences(content)) as { claims: RawClaim[] }).claims ?? [];
}

function buildVideoLink(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Time span of a context excerpt: the earliest start and latest end among the
 * cues whose text falls inside the (verbatim) context. start → deep-link,
 * [start, end] → clip bounds. Returns {} when nothing lines up.
 */
const MIN_SNAP_MATCH_CHARS = 12;
function contextTimeSpan(context: string, cues: SubtitleCue[]): { start?: number; end?: number } {
  const ctx = normalize(context);
  if (!ctx) return {};
  let start: number | undefined;
  let end: number | undefined;
  for (const cue of cues) {
    const t = normalize(cue.text);
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

/** YouTube path: timestamped cues → claims with snapped timestamps + deep-links. */
async function extractFromCues(
  cues: SubtitleCue[],
  videoId: string,
  concurrency: number,
): Promise<ExtractedClaim[]> {
  const queue = new PQueue({ concurrency });
  const perChunk = await Promise.all(
    // Plain text for the LLM — timestamps are snapped from the cues afterwards,
    // so no [seconds] markers to leak into the verbatim context.
    chunkCues(cues).map((chunk) =>
      queue.add(() => runExtraction(`Transcript segment:\n\n${chunk.map((c) => c.text).join("\n")}`)),
    ),
  );
  return perChunk
    .flat()
    .filter((c): c is RawClaim => !!c)
    .map((c) => {
      // Resolve the context's span against the full cue list (chunk-edge safe).
      const { start, end } = contextTimeSpan(c.context, cues);
      return {
        claim: c.claim,
        judgement: c.judgement,
        context: c.context,
        anchor: {
          kind: "youtube" as const,
          startSeconds: start,
          endSeconds: end,
          deepLinkUrl: start !== undefined ? buildVideoLink(videoId, start) : undefined,
        },
      };
    });
}

/** Article path: plain text → claims anchored to the article URL. */
async function extractFromText(text: string, url: string, concurrency: number): Promise<ExtractedClaim[]> {
  const queue = new PQueue({ concurrency });
  const perChunk = await Promise.all(
    chunkText(text).map((chunk) => queue.add(() => runExtraction(`Article excerpt:\n\n${chunk}`))),
  );
  return perChunk
    .flat()
    .filter((c): c is RawClaim => !!c)
    .map((c) => ({ claim: c.claim, judgement: c.judgement, context: c.context, anchor: { kind: "substack" as const, url } }));
}

export async function extractClaims(content: FetchedContent, concurrency: number): Promise<ExtractedClaim[]> {
  return content.kind === "youtube"
    ? extractFromCues(content.cues, content.videoId, concurrency)
    : extractFromText(content.text, content.url, concurrency);
}
