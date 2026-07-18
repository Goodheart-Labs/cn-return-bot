/**
 * Read and update the persisted writing_limit (X's cap on notes per 24h window).
 *
 * The value is observation-based: it only moves in response to X's actual
 * responses. We never infer it from submission counts alone, because X's cap
 * can drop at any time and a stale "we submitted N" tells us nothing about
 * the current cap.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";

// X caps notes per rolling 24h window — the window we count submissions over.
const SUBMISSION_WINDOW_HOURS = 24;
// How long after a daily-limit hit we still treat ourselves as capped (narrowing
// the feed). Shorter than the submission window: the cap can lift mid-window, so
// we re-broaden sooner rather than staying pessimistic for a full day.
const RECENTLY_HIT_WINDOW_HOURS = 6;
// After the limit's been binding this long, probe X once by nudging the stored
// limit up by 1 (see probeWritingLimitAfterCooldown). Long enough that X has
// plausibly aged a note out of the rolling window and freed a slot.
const PROBE_COOLDOWN_MINUTES = 95;
const STATE_KEY = "writing_limit";
const LIMIT_HIT_AT_KEY = "limit_hit_at";
// The cap proven at the last hit (X). Frozen at hit time — unlike writing_limit,
// which probes upward on every success — so we can tell whether submissions have
// since climbed above X (the cap rose) or merely refilled back to it.
const LIMIT_HIT_VALUE_KEY = "limit_hit_value";

export async function readWritingLimit(logger: SupabaseLogger): Promise<number | null> {
  const raw = await logger.getPipelineState(STATE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Daily-limit error from X: cap is exactly the current submission count. */
export async function recordDailyLimitHit(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  await logger.setPipelineState(LIMIT_HIT_AT_KEY, new Date().toISOString());
  await logger.setPipelineState(LIMIT_HIT_VALUE_KEY, String(count));
  await logger.setPipelineState(STATE_KEY, String(count));
  console.log(`[writing-limit] Daily limit hit → writing_limit=${count}`);
}

/**
 * True while we should still treat ourselves as capped: X rejected a submission
 * with its daily limit within the last `windowHours` AND submissions haven't
 * since climbed above the cap proven at that hit (X).
 *
 * Once submissions exceed X the cap has risen — a submission only succeeds above
 * X if X let it — so we're no longer capped. Submissions merely refilling a slot
 * freed as an old note ages out (count == X) leave us capped. We compare the live
 * count to X rather than writing_limit, which probes to count+1 on every success
 * (including refills) and so can't distinguish a real cap-rise from a refill.
 *
 * `windowHours` defaults to the feed-narrowing window; callers needing a
 * different confidence horizon (e.g. per-run post budgeting) pass their own.
 */
export async function hitWritingLimitRecently(
  logger: SupabaseLogger,
  windowHours: number = RECENTLY_HIT_WINDOW_HOURS,
): Promise<boolean> {
  const raw = await logger.getPipelineState(LIMIT_HIT_AT_KEY);
  if (!raw) return false;
  const hitAt = Date.parse(raw);
  if (!Number.isFinite(hitAt)) return false;
  if (Date.now() - hitAt >= windowHours * 60 * 60 * 1000) return false;

  const capAtHit = Number(await logger.getPipelineState(LIMIT_HIT_VALUE_KEY));
  if (!Number.isFinite(capAtHit)) return true; // no proven cap to compare — stay capped
  const submissions = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  return submissions <= capAtHit;
}

/**
 * Caller has already determined this run would skip (writing limit reached). If
 * X last rejected us more than the cooldown ago, nudge the stored limit up by 1
 * so we attempt one note instead of skipping — X may have freed a slot as an old
 * note aged out. If the probe note lands, bumpWritingLimitFromSuccess takes over
 * and keeps climbing; if X still rejects, recordDailyLimitHit resets the cooldown
 * and we back off another window. Returns whether it bumped (caller re-budgets).
 */
export async function probeWritingLimitAfterCooldown(logger: SupabaseLogger): Promise<boolean> {
  const raw = await logger.getPipelineState(LIMIT_HIT_AT_KEY);
  if (!raw) return false;
  const hitAt = Date.parse(raw);
  if (!Number.isFinite(hitAt)) return false;
  if (Date.now() - hitAt < PROBE_COOLDOWN_MINUTES * 60 * 1000) return false;

  const current = await readWritingLimit(logger);
  if (current === null) return false;
  const probe = current + 1;
  await logger.setPipelineState(STATE_KEY, String(probe));
  console.log(`[writing-limit] Cooldown elapsed while capped → probing writing_limit=${probe} (was ${current})`);
  return true;
}

/**
 * Successful submission: cap is at least the current count, so bump the stored
 * value to count+1. The +1 lets the next run probe one above the proven floor.
 * Never lowers the stored value — only X's daily-limit error does that.
 */
export async function bumpWritingLimitFromSuccess(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  const probe = count + 1;
  const current = await readWritingLimit(logger);
  if (current !== null && current >= probe) return;
  await logger.setPipelineState(STATE_KEY, String(probe));
  console.log(`[writing-limit] Submission succeeded → writing_limit=${probe} (was ${current ?? "unset"})`);
}
