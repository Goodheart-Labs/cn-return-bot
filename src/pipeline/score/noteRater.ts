/**
 * The note rater: one cheap LLM call that forecasts how raters will treat a
 * finished note. The submit phase orders notes by it, so when X's writing limit
 * leaves room for only some of the notes we wrote, the ones it rates best go
 * first and the rest wait in the queue (see noteQueue.ts).
 *
 * Backtest (2026-09-21, 2,045 matured notes Aug 7 - Sep 11, this exact prompt
 * and model, never fitted): keeping the top half of each day's notes by
 * p_helpful - p_not_helpful raised net (helpful% - not-helpful%) per submitted
 * note from 8.1% to 12.2%, +4.1pp [+3.0, +5.4] day-block bootstrap. It held in
 * both halves: August +4.3pp, September +3.7pp [+1.3, +6.1]. About $0.002 a note.
 */

import { trackedLlmCreate } from "../cost-tracking/costTracker";
import { parseJsonWithRetry } from "../utils/jsonLlmCall";
import { stripJsonFences } from "../utils/jsonOutput";
import {
  NOTE_RATER_SYSTEM_PROMPT,
  NOTE_RATER_RESPONSE_FORMAT,
  NOTE_RATER_SCHEMA_HINT,
  buildNoteRaterUserMessage,
} from "../prompts/noteRater";

export const NOTE_RATER_MODEL = "google/gemini-3.8-flash";

export interface NoteRating {
  pHelpful: number;
  pNotHelpful: number;
  model: string;
  cost: number;
  engages?: number;
  topic?: string;
  reason?: string;
}

/** Higher goes first. Probabilities are 0-1. */
export function raterPriority(r: Pick<NoteRating, "pHelpful" | "pNotHelpful">): number {
  return r.pHelpful - r.pNotHelpful;
}

const URL_RX = /https?:\/\/\S+/g;

/** Same split as the backtest's pairs.py: source_url can hold several URLs. */
export function splitUrls(s: string | null | undefined): string[] {
  if (!s || !s.trim()) return [];
  const found = s.match(URL_RX);
  if (found) return found.map((u) => u.replace(/[).,;'"]+$/, ""));
  return s.split(/[\s,;]+/).filter(Boolean);
}

interface RawRating {
  p_helpful: number;
  p_not_helpful: number;
  topic?: string;
  engages?: number;
  reason?: string;
}

function parseRating(text: string): RawRating {
  const r = JSON.parse(text) as RawRating;
  const ok = (v: unknown) => typeof v === "number" && v >= 0 && v <= 100;
  if (!ok(r.p_helpful) || !ok(r.p_not_helpful)) throw new Error("rating out of range");
  return r;
}

/** Throws on failure. Callers treat an unrated note as ranking last. */
export async function rateNote(p: { postText: string; noteText: string; sourceUrl?: string | null }): Promise<NoteRating> {
  let cost = 0;
  const messages = [
    { role: "system", content: NOTE_RATER_SYSTEM_PROMPT },
    { role: "user", content: buildNoteRaterUserMessage({ postText: p.postText, noteText: p.noteText, urls: splitUrls(p.sourceUrl) }) },
  ];
  const r = await parseJsonWithRetry<RawRating>({
    source: "noteRater",
    messages,
    schemaHint: NOTE_RATER_SCHEMA_HINT,
    call: async (msgs, attempt) => {
      const { response, costEntry } = await trackedLlmCreate(attempt === 1 ? "noteRater" : `noteRater.retry.${attempt - 1}`, {
        model: NOTE_RATER_MODEL,
        messages: msgs,
        response_format: NOTE_RATER_RESPONSE_FORMAT,
        temperature: 0,
        max_tokens: 2000,
      } as any);
      cost += costEntry.cost ?? 0;
      const content = response.choices?.[0]?.message?.content ?? "{}";
      return { toParse: stripJsonFences(content), assistantEcho: content };
    },
    parse: parseRating,
  });
  return {
    pHelpful: r.p_helpful / 100,
    pNotHelpful: r.p_not_helpful / 100,
    model: NOTE_RATER_MODEL,
    cost,
    engages: r.engages,
    topic: r.topic,
    reason: r.reason,
  };
}
