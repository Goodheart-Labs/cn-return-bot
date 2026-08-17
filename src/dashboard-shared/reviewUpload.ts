/**
 * The single place that maps a row of the results CSV onto a
 * review_dashboard_items insert. Both upload paths use it: the dashboard's
 * UploadDialog and the auto-open flow of a local run. That keeps their column
 * lists from drifting apart. They did drift once, and auto-opened runs silently
 * lost judge_guidance, original_note_text, and failure_reason.
 */

import { stripNullChars } from "../utils/stripNullChars";

function nullIfEmpty(v: unknown): string | null {
  return v === undefined || v === null || v === "" ? null : (v as string);
}

function parseLogs(logs: unknown): unknown {
  if (!logs) return null;
  if (typeof logs !== "string") return logs;
  try {
    return JSON.parse(logs);
  } catch {
    return logs; // The text is not valid JSON, so we keep it as it is.
  }
}

export interface ReviewItemInsert {
  upload_id: string;
  url: string;
  tweet_text: string | null;
  needs_note: string | null;
  ground_truth_note: string | null;
  bot_id: string | null;
  note_status: string | null;
  outcome: string | null;
  result: string | null;
  note_text: string | null;
  source_verification: string | null;
  evaluation_score: number | null;
  logs: unknown;
  judge_guidance: string | null;
  original_note_text: string | null;
  failure_reason: string | null;
}

export function csvRowToReviewItemInsert(
  uploadId: string,
  r: Record<string, any>,
): ReviewItemInsert {
  // Remove NUL characters from every free-text and JSONB field before the
  // insert. Model output can contain U+0000, for example from Gemini's media
  // OCR. Postgres rejects such a value with error 22P05, and that would fail the
  // whole upload batch.
  return stripNullChars({
    upload_id: uploadId,
    url: r.url ?? "",
    tweet_text: nullIfEmpty(r.text),
    needs_note: nullIfEmpty(r.needs_note),
    ground_truth_note: nullIfEmpty(r.ground_truth_note),
    bot_id: nullIfEmpty(r.bot_id),
    note_status: nullIfEmpty(r.note_status),
    outcome: nullIfEmpty(r.outcome),
    result: nullIfEmpty(r.result),
    note_text: nullIfEmpty(r.note_text),
    source_verification: nullIfEmpty(r.source_verification),
    evaluation_score: r.evaluation_score ? Number(r.evaluation_score) : null,
    logs: parseLogs(r.logs),
    judge_guidance: nullIfEmpty(r.judge_guidance),
    original_note_text: nullIfEmpty(r.original_note_text),
    failure_reason: nullIfEmpty(r.failure_reason),
  });
}
