/**
 * Reads and updates the stored writing_limit. That is our estimate of X's cap on
 * how many notes we may submit per 24 hour window.
 *
 * The value only moves in response to what X actually answered. We never infer
 * it from submission counts on their own. X can lower its cap at any time, so
 * the fact that we once submitted N notes says nothing about the cap today.
 */

import type { SupabaseLogger } from "../../api/supabaseClient";

// X applies its cap over a rolling 24 hour window, so that is the window we count
// our submissions over.
const SUBMISSION_WINDOW_HOURS = 24;
// How long after a daily-limit rejection we keep treating ourselves as capped,
// which narrows the feed. It is shorter than the submission window on purpose.
// The cap can lift part way through a window, and we would rather broaden again
// early than stay pessimistic for a whole day.
const RECENTLY_HIT_WINDOW_HOURS = 6;
// Once the limit has been binding for this long, we probe X once by nudging the
// stored limit up by 1. See probeWritingLimitAfterCooldown. The wait is long
// enough that X's cap may plausibly have risen since it last rejected us.
const PROBE_COOLDOWN_MINUTES = 95;
const STATE_KEY = "writing_limit";
const LIMIT_HIT_AT_KEY = "limit_hit_at";
// The cap X proved at the last rejection. Call it the proven cap. It is frozen at
// that moment, unlike writing_limit, which probes upward after every success.
// Freezing it is what lets us tell two situations apart later. Submissions
// climbing above the proven cap means the cap itself rose. Submissions merely
// returning to it means a slot was refilled.
const LIMIT_HIT_VALUE_KEY = "limit_hit_value";

export async function readWritingLimit(logger: SupabaseLogger): Promise<number | null> {
  const raw = await logger.getPipelineState(STATE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Records a daily-limit error from X. Such an error proves the cap is exactly
 *  the number of notes we have submitted in the current window. */
export async function recordDailyLimitHit(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  await logger.setPipelineState(LIMIT_HIT_AT_KEY, new Date().toISOString());
  await logger.setPipelineState(LIMIT_HIT_VALUE_KEY, String(count));
  await logger.setPipelineState(STATE_KEY, String(count));
  console.log(`[writing-limit] Daily limit hit → writing_limit=${count}`);
}

/**
 * Returns true while we should still treat ourselves as capped. Two things have
 * to hold. X must have rejected a submission with its daily limit within the last
 * `windowHours`. And our submission count must not have climbed above the cap
 * that rejection proved.
 *
 * Once the count exceeds the proven cap, the cap has risen. A submission above
 * the proven cap can only have succeeded because X allowed it, so we are no
 * longer capped. A count that merely returns to the proven cap means an old note
 * aged out and we refilled its slot, and we stay capped.
 *
 * We compare the live count against the proven cap rather than against
 * writing_limit. writing_limit probes to the count plus one after every success,
 * including a refill, so it cannot tell a real rise from a refill.
 *
 * `windowHours` defaults to the window used for narrowing the feed. A caller that
 * wants a different horizon passes its own. Budgeting how many posts one run may
 * process is one such caller.
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
  // With no proven cap to compare against we stay capped.
  if (!Number.isFinite(capAtHit)) return true;
  const submissions = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  return submissions <= capAtHit;
}

/**
 * The caller has already worked out that this run would skip, because the writing
 * limit is reached. If X last rejected us longer ago than the cooldown, we nudge
 * the stored limit up by 1 so the run attempts one note instead of skipping. That
 * one note tests whether X's cap has risen above the count it last rejected us
 * at.
 *
 * This probe is only for the case where our submission count still equals the
 * stored limit. When an old note ages out, the count drops on its own and lifts
 * us off the limit without any probe.
 *
 * If the probe note is accepted, bumpWritingLimitFromSuccess takes over and keeps
 * climbing. If X rejects it again, recordDailyLimitHit resets the cooldown and we
 * back off for another window.
 *
 * Returns whether the stored limit was bumped, so the caller can budget the run
 * again.
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
 * Records a successful submission. Success proves the cap is at least the current
 * submission count, so we store that count plus one. The extra one lets the next
 * run probe a single note above the floor we have proven.
 *
 * This function never lowers the stored value. Only X's daily-limit error does
 * that.
 */
export async function bumpWritingLimitFromSuccess(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS);
  const probe = count + 1;
  const current = await readWritingLimit(logger);
  if (current !== null && current >= probe) return;
  await logger.setPipelineState(STATE_KEY, String(probe));
  console.log(`[writing-limit] Submission succeeded → writing_limit=${probe} (was ${current ?? "unset"})`);
}
