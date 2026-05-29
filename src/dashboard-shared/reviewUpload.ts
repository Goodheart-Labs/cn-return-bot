/**
 * Single source of truth for mapping a results-CSV row → a review_dashboard_items
 * insert. Both upload paths (the dashboard's UploadDialog and the local-run
 * auto-open flow) use this so their column lists can't drift — a past drift
 * silently dropped judge_guidance/original_note_text/failure_reason from
 * auto-opened runs.
 */

function nullIfEmpty(v: unknown): string | null {
  return v === undefined || v === null || v === "" ? null : (v as string);
}

function parseLogs(logs: unknown): unknown {
  if (!logs) return null;
  if (typeof logs !== "string") return logs;
  try {
    return JSON.parse(logs);
  } catch {
    return logs; // keep raw string if it isn't valid JSON
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
  return {
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
  };
}
