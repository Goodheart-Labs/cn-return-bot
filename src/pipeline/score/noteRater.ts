/**
 * The note rater: one cheap LLM call that forecasts how raters will treat a
 * finished note, made before the note is submitted. The forecast is stored as a
 * pipeline_scores row of type "note_rater". Nothing acts on it yet. About
 * $0.002 a note.
 */

import { trackedLlmCreate } from "../cost-tracking/costTracker";
import { parseJsonWithRetry } from "../utils/jsonLlmCall";
import { stripJsonFences } from "../utils/jsonOutput";
import { withLlmAbortSignal } from "../llm/llm";
import type { SupabaseLogger } from "../../api/supabaseClient";
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
  // Whole percentages only: a 0-1 answer such as 0.3 would otherwise pass as 0.3%.
  const ok = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
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

// Set the repo variable NOTE_RATER_ENABLED=false to stop forecasting notes.
export function noteRaterEnabled(): boolean {
  return process.env.NOTE_RATER_ENABLED !== "false";
}

// One forecast may not hold up a run: the default LLM deadline is 15 minutes.
const RATER_TIMEOUT_MS = 30_000;

/** Forecasts a finished note and stores the forecast. Never throws: a failure
 *  returns null and the note carries on without a forecast. */
export async function rateCandidate(
  logger: SupabaseLogger | null,
  note: { tweetId: string; postText: string; noteText?: string | null; sourceUrl?: string | null; pipelineRunId?: string | null },
): Promise<NoteRating | null> {
  const noteText = note.noteText;
  if (!noteRaterEnabled() || !noteText) return null;
  try {
    const rating = await withLlmAbortSignal(AbortSignal.timeout(RATER_TIMEOUT_MS), () =>
      rateNote({ postText: note.postText, noteText, sourceUrl: note.sourceUrl ?? null }));
    if (logger && note.pipelineRunId) {
      try { await logger.recordNoteRating(note.pipelineRunId, rating); }
      catch (err) { console.warn(`[noteRater] could not store the forecast for ${note.tweetId}:`, err); }
    }
    console.log(`[noteRater] ${note.tweetId}: helpful ${Math.round(rating.pHelpful * 100)}%, not helpful ${Math.round(rating.pNotHelpful * 100)}%`);
    return rating;
  } catch (err) {
    console.warn(`[noteRater] forecast failed for ${note.tweetId}:`, (err as Error)?.message ?? err);
    return null;
  }
}
