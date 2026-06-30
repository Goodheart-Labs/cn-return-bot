/**
 * Read and update the persisted writing_limit (X's cap on notes per 24h window).
 *
 * The value is observation-based: it only moves in response to X's actual
 * responses. We never infer it from submission counts alone, because X's cap
 * can drop at any time and a stale "we submitted N" tells us nothing about
 * the current cap.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";

const WINDOW_HOURS = 24;
const STATE_KEY = "writing_limit";
const LIMIT_HIT_AT_KEY = "limit_hit_at";

export async function readWritingLimit(logger: SupabaseLogger): Promise<number | null> {
  const raw = await logger.getPipelineState(STATE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Daily-limit error from X: cap is exactly the current submission count. */
export async function recordDailyLimitHit(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(WINDOW_HOURS);
  await logger.setPipelineState(LIMIT_HIT_AT_KEY, new Date().toISOString());
  await logger.setPipelineState(STATE_KEY, String(count));
  console.log(`[writing-limit] Daily limit hit → writing_limit=${count}`);
}

/**
 * True if X rejected a submission with its daily limit within the last
 * WINDOW_HOURS. Absent a real hit, writing_limit is only a probe (count+1),
 * so the remaining-slots estimate is artificially ~1 — we don't let that
 * narrow the feed; we only narrow once we've proven we're capped.
 */
export async function hitWritingLimitRecently(logger: SupabaseLogger): Promise<boolean> {
  const raw = await logger.getPipelineState(LIMIT_HIT_AT_KEY);
  if (!raw) return false;
  const hitAt = Date.parse(raw);
  if (!Number.isFinite(hitAt)) return false;
  return Date.now() - hitAt < WINDOW_HOURS * 60 * 60 * 1000;
}

/**
 * Successful submission: cap is at least the current count, so bump the stored
 * value to count+1. The +1 lets the next run probe one above the proven floor.
 * Never lowers the stored value — only X's daily-limit error does that.
 */
export async function bumpWritingLimitFromSuccess(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(WINDOW_HOURS);
  const probe = count + 1;
  const current = await readWritingLimit(logger);
  if (current !== null && current >= probe) return;
  await logger.setPipelineState(STATE_KEY, String(probe));
  console.log(`[writing-limit] Submission succeeded → writing_limit=${probe} (was ${current ?? "unset"})`);
}
