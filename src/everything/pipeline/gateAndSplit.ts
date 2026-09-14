/**
 * The gate and split step of the everything pipeline. One cheap call reads the
 * whole text and answers two questions: does the text try to shape the reader's
 * beliefs at all, and if so, does it fall into parts about different topics.
 *
 * An announcement, a personal update or entertainment is not checkable, and the
 * item is finished right there without extraction or rating. A checkable text
 * is cut into parts so that the rating step can research one topic at a time,
 * where one good source settles many claims. The model marks a part by copying
 * its first sentence or two. We locate that excerpt in the text and cut there.
 * A part runs to the next part's start, and whatever comes before the first
 * part is the introduction, so no text can fall in a gap.
 */

import { trackLlmCall, trackedLlmCreate } from "../../pipeline/cost-tracking/costTracker";
import type { SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import { jsonSchemaResponseFormat } from "../../pipeline/prompts/responseFormat";
import { parseJsonWithRetry } from "../../pipeline/utils/jsonLlmCall";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";
import { EVERYTHING_MODEL } from "./model";

const GATE_SPLIT_SYSTEM_PROMPT = `You read a text (an article or a podcast transcript) and answer two questions.

1. Does the text try to shape the reader's beliefs about the world: argue a point, explain how something is, report what happened, give advice? Answer "checkable": true. If it is an announcement, a personal update, an event notice, a list of links, entertainment, or anything else that makes no claims worth checking, answer "checkable": false and say why in "reason".

2. If it is checkable, decide whether it falls into parts that each deal with a different topic or question. It is fine not to split: a text about one topic, or a short text, gets an empty "parts" list. Only split when the parts really are about different things, so that research on one part would not help the others. For each part give a short "title" and copy the first one or two sentences of the part verbatim into "start_excerpt". Parts follow the reading order. Everything before the first part's start is the introduction, so do not make the introduction a part.`;

const GATE_SPLIT_SCHEMA_HINT = `{ "checkable": boolean, "reason": string, "parts": [{ "title": string, "start_excerpt": string }] }`;

const GATE_SPLIT_RESPONSE_FORMAT = jsonSchemaResponseFormat("gate_and_split", {
  type: "object",
  properties: {
    checkable: { type: "boolean" },
    reason: { type: "string", description: "Why the text is or is not checkable, one sentence." },
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title of the part." },
          start_excerpt: { type: "string", description: "The first one or two sentences of the part, copied verbatim." },
        },
        required: ["title", "start_excerpt"],
        additionalProperties: false,
      },
    },
  },
  required: ["checkable", "reason", "parts"],
  additionalProperties: false,
});

export interface PartStart {
  title: string;
  startExcerpt: string;
}

export type GateSplitVerdict =
  | { kind: "not_checkable"; reason: string }
  | { kind: "checkable"; starts: PartStart[] };

interface RawGateSplit {
  checkable: boolean;
  reason: string;
  parts: { title: string; start_excerpt: string }[];
}

/** Parses the model's reply and checks its shape, throwing on anything else so
 *  the retry loop asks again. */
export function parseGateSplitOutput(toParse: string): RawGateSplit {
  const output = JSON.parse(toParse) as RawGateSplit;
  const shapeOk =
    typeof output.checkable === "boolean" &&
    typeof output.reason === "string" &&
    Array.isArray(output.parts) &&
    output.parts.every((p) => typeof p?.title === "string" && typeof p?.start_excerpt === "string");
  if (!shapeOk) throw new Error("gate and split JSON missing checkable/reason/parts");
  return output;
}

/** One call over the whole text. The cost lands in the active cost tracker,
 *  which the extraction service records against the item. */
export async function gateAndSplit(text: string, title: string | undefined): Promise<GateSplitVerdict> {
  const output = await parseJsonWithRetry<RawGateSplit>({
    source: "gate_and_split",
    messages: [
      { role: "system", content: GATE_SPLIT_SYSTEM_PROMPT },
      { role: "user", content: title ? `Title: ${title}\n\n${text}` : text },
    ],
    schemaHint: GATE_SPLIT_SCHEMA_HINT,
    call: async (messages, attempt) => {
      const callName = attempt === 1 ? "gate_and_split" : `gate_and_split.retry.${attempt - 1}`;
      const { response, costEntry } = await trackedLlmCreate(callName, {
        model: EVERYTHING_MODEL,
        messages,
        response_format: GATE_SPLIT_RESPONSE_FORMAT,
      } as any);
      trackLlmCall(costEntry);
      const answer = (response as any).choices?.[0]?.message?.content ?? "{}";
      return { toParse: stripJsonFences(answer), assistantEcho: answer };
    },
    parse: parseGateSplitOutput,
  });
  if (!output.checkable) return { kind: "not_checkable", reason: output.reason };
  return { kind: "checkable", starts: output.parts.map((p) => ({ title: p.title, startExcerpt: p.start_excerpt })) };
}

// ---------------------------------------------------------------------------
// Locating the excerpts and cutting the text
// ---------------------------------------------------------------------------

/** A text in the loose form normalizeText produces (lower case, punctuation
 *  turned to spaces, whitespace collapsed), remembering for every normalized
 *  character where it came from in the original. normalizeText itself throws
 *  the offsets away, and cutting needs them. */
class IndexedText {
  readonly normalized: string;
  private readonly rawIndex: number[] = [];

  constructor(raw: string) {
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const lower = raw[i]!.toLowerCase();
      const keep = lower.length === 1 && /[a-z0-9]/.test(lower);
      const ch = keep ? lower : " ";
      if (ch === " " && (out.length === 0 || out.endsWith(" "))) continue;
      out += ch;
      this.rawIndex.push(i);
    }
    this.normalized = out;
  }

  /** The original offset of the first match of `excerpt` at or after the
   *  original offset `fromRaw`, or null when it does not occur there. */
  find(excerpt: string, fromRaw: number): number | null {
    const needle = new IndexedText(excerpt).normalized;
    if (!needle) return null;
    let fromNorm = this.rawIndex.findIndex((r) => r >= fromRaw);
    if (fromNorm === -1) return null;
    const at = this.normalized.indexOf(needle, fromNorm);
    return at === -1 ? null : this.rawIndex[at]!;
  }
}

/** Where each part begins in the text, as offsets into the original string.
 *  Each start is searched for after the previous one, so a sentence the author
 *  repeats resolves to the later occurrence. Null when any start cannot be
 *  found or the starts do not advance, which makes the whole split unusable;
 *  the caller then treats the text as one part. */
export function locatePartStarts(text: string, starts: PartStart[]): number[] | null {
  const indexed = new IndexedText(text);
  const offsets: number[] = [];
  let from = 0;
  for (const start of starts) {
    const at = indexed.find(start.startExcerpt, from);
    if (at === null) return null;
    offsets.push(at);
    from = at + 1;
  }
  return offsets;
}

export interface TextPart {
  title: string;
  text: string;
}

export interface TextCut {
  /** The text before the first part. Null when the first part starts at the
   *  very beginning. */
  introduction: string | null;
  parts: TextPart[];
}

/** Cuts the text at the part starts. Null when the starts are empty or cannot
 *  be located. */
export function cutText(text: string, starts: PartStart[]): TextCut | null {
  if (starts.length === 0) return null;
  const offsets = locatePartStarts(text, starts);
  if (!offsets) return null;
  const introduction = text.slice(0, offsets[0]).trim();
  const parts = starts.map((start, i) => ({
    title: start.title,
    text: text.slice(offsets[i], offsets[i + 1] ?? text.length).trim(),
  }));
  return { introduction: introduction || null, parts };
}

export interface CuePart {
  title: string;
  cues: SubtitleCue[];
}

export interface CueCut {
  introduction: SubtitleCue[];
  parts: CuePart[];
}

/** The transcript text a video's cues make when joined. Every place that turns
 *  cues into text uses this same joining, so an offset into it maps back onto
 *  a cue. */
export function joinCues(cues: SubtitleCue[]): string {
  return cues.map((c) => c.text).join("\n");
}

/** The index of the cue that contains the given offset of the joined text. */
function cueIndexAt(cues: SubtitleCue[], offset: number): number {
  let end = 0;
  for (let i = 0; i < cues.length; i++) {
    end += cues[i]!.text.length + 1;
    if (offset < end) return i;
  }
  return cues.length - 1;
}

/** The cue version of cutText: a part is a range of whole cues, so every claim
 *  keeps its timestamp. A start that falls inside a cue begins that cue's
 *  part at the cue. Null when the starts cannot be located or two starts land
 *  in the same cue. */
export function cutCues(cues: SubtitleCue[], starts: PartStart[]): CueCut | null {
  if (starts.length === 0) return null;
  const offsets = locatePartStarts(joinCues(cues), starts);
  if (!offsets) return null;
  const indices = offsets.map((offset) => cueIndexAt(cues, offset));
  if (indices.some((idx, i) => i > 0 && idx <= indices[i - 1]!)) return null;
  return {
    introduction: cues.slice(0, indices[0]),
    parts: starts.map((start, i) => ({ title: start.title, cues: cues.slice(indices[i], indices[i + 1] ?? cues.length) })),
  };
}
