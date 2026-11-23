import type { SupabaseLogger } from "../../api/supabaseClient";

/**
 * Our estimate of X's writing limit: how many notes X lets us submit in 24
 * hours. It never stops a submission; only X's refusal does. It decides how
 * many tweets we check, so that we write a little more than X will take.
 *
 * Since GOO-865 the estimate probes upwards exponentially. Each time the notes
 * of the last 24 hours reach the estimate without a refusal, it rises by the
 * step, and the step doubles: +1, +2, +4, +8 and so on. When X refuses a note
 * for the daily limit, the database sets the estimate to the notes we had in
 * the 24 hours before (finish_note_submission_claim, migration 100), and the
 * step goes back to 1. Until GOO-865 the step was always 1.
 */
const LIMIT_KEY = "writing_limit";
const STEP_KEY = "writing_limit_step";
const FIRST_STEP = 1;

async function readCount(logger: SupabaseLogger, key: string): Promise<number | null> {
  const raw = await logger.getPipelineState(key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** The next estimate and step after a successful submission, or null when the
 *  notes of the last 24 hours have not reached the estimate yet. */
export function nextWritingLimit(notesIn24h: number, limit: number | null, step: number): { limit: number; step: number } | null {
  if (limit !== null && notesIn24h < limit) return null;
  return { limit: notesIn24h + step, step: step * 2 };
}

/** Raises the estimate after a successful submission, as described above. */
export async function bumpWritingLimitFromSuccess(logger: SupabaseLogger): Promise<void> {
  const [count, limit, step] = await Promise.all([
    logger.countRecentSubmissions(24),
    readCount(logger, LIMIT_KEY),
    readCount(logger, STEP_KEY),
  ]);
  const next = nextWritingLimit(count, limit, step ?? FIRST_STEP);
  if (!next) return;
  await logger.setPipelineState(LIMIT_KEY, String(next.limit));
  await logger.setPipelineState(STEP_KEY, String(next.step));
  console.log(`[writing-limit] ${count} notes in 24h reached the estimate → writing_limit=${next.limit} (was ${limit ?? "unset"}), next step ${next.step}`);
}

/** Starts the probe over after X refused a note for the daily limit. */
export async function resetWritingLimitStep(logger: SupabaseLogger): Promise<void> {
  await logger.setPipelineState(STEP_KEY, String(FIRST_STEP));
  console.log(`[writing-limit] X refused a note for the daily limit → the probe's step goes back to ${FIRST_STEP}`);
}
