/**
 * Predicted views still to come: how many more views a post will get until it
 * is 48 hours old. Since GOO-863 the X run picks posts by this number instead of
 * by velocity (views divided by age, see velocity.ts).
 *
 * The prediction is the post's speed now times the hours it has left at that
 * speed. The speed now comes from two readings of the post's view count about
 * 10 to 30 minutes apart. The first reading is the feed view recorder's
 * (cn-feed-views, src/feed-views/), which reads every post in X's XL feed every
 * 10 minutes. The second is the X run's own fetch.
 *
 * The hours left come from what the recorded view curves showed (GOO-834,
 * src/scripts_jim/2026_11_21_feed_views_model/, cliff_model.py and
 * production_fit.py). A post's speed fades as a power of its age: from age a to
 * age t it is multiplied by (t / a)^-0.73. When a post turns 24 hours old, X
 * spreads it much less, and its speed falls to 0.55 of what it was within about
 * half an hour. After that it also fades by e^(-(t - 24) / 19.7). Adding this
 * speed up until 48 hours gives the effective hours left. They rise from 5.6 at
 * 1 hour to 13.1 at 9 hours, because a young post's speed is a burst that
 * fades fast. They then fall to 6.2 just before 24 hours, because the cliff
 * comes closer. On held-out posts the prediction is typically within a factor
 * of 1.6 to 1.7 for posts 3 to 23 hours old, against 7 to 14 for velocity.
 */

import { formatCount } from "../orchestration/utils/tweetSorting";
import { isAboveVelocityFloor } from "./velocity";

const FADE_POWER = 0.731;
const SPEED_KEPT_AFTER_CLIFF = 0.549;
const FADE_AFTER_CLIFF_HOURS = 19.7;
const CLIFF_AGE_HOURS = 24;
export const VIEWS_HORIZON_HOURS = 48;
const INTEGRATION_STEP_HOURS = 1 / 30;
/** A post younger than this is measured as if it were this old, as velocity
 *  does, so that the fade from a few minutes of age does not explode. */
const MIN_AGE_HOURS = 0.25;

/**
 * The floor on predicted views still to come. A post below it is not checked.
 * 80,000 admits as many posts as the old floor of 15,000 views per hour did:
 * about 426 of the posts under 24 hours old at each X run, replayed over 117
 * runs from 2026-11-20 to 2026-11-23. 80% of them are the same posts.
 */
export const VIEWS_TO_COME_FLOOR = 80_000;

/** The hours left at today's speed until the post is 48 hours old, given the
 *  fading and the 24-hour cliff described above. */
export function effectiveHoursLeft(ageHours: number): number {
  const a = Math.max(ageHours, MIN_AGE_HOURS);
  let hours = 0;
  for (let t = a + INTEGRATION_STEP_HOURS / 2; t < VIEWS_HORIZON_HOURS; t += INTEGRATION_STEP_HOURS) {
    const cliffDrop = a < CLIFF_AGE_HOURS && t >= CLIFF_AGE_HOURS ? SPEED_KEPT_AFTER_CLIFF : 1;
    const fadeAfterCliff = Math.exp(-(Math.max(t, CLIFF_AGE_HOURS) - Math.max(a, CLIFF_AGE_HOURS)) / FADE_AFTER_CLIFF_HOURS);
    hours += (t / a) ** -FADE_POWER * cliffDrop * fadeAfterCliff * INTEGRATION_STEP_HOURS;
  }
  return hours;
}

/** The earlier reading comes from the newest recorder walk that started at
 *  least this many minutes before the X run. Shorter gaps would be mostly
 *  noise, because X refreshes a count only every few minutes. */
export const EARLIER_READING_MIN_AGE_MINUTES = 10;
/** With no walk up to this many minutes old, the recorder counts as down. Its
 *  walks are 10 minutes apart, so this leaves room for two missed walks. */
export const EARLIER_READING_MAX_AGE_MINUTES = 40;

/**
 * Whether a post still clears today's floor, judged on the numbers frozen when
 * it was selected. A post selected on a prediction answers to the views floor.
 * One selected without a prediction, by a pre-pass or in a run without recorder
 * readings, answers to the velocity floor, which fails open on an unknown
 * velocity.
 */
export function clearsFloor(viewsToCome: number | null | undefined, velocity: number | null | undefined): boolean {
  return viewsToCome != null ? viewsToCome >= VIEWS_TO_COME_FLOOR : isAboveVelocityFloor(velocity ?? null);
}

/** A reading of a post's view count. */
export interface ViewReading {
  impressions: number;
  observedAtMs: number;
}

/**
 * Predicts the views a post will still get until it is 48 hours old, from an
 * earlier reading and the reading now. Returns null when either reading or the
 * posting time is missing, or when the two readings are not in time order. A
 * view count that went down counts as no growth.
 */
export function predictViewsToCome(postedAtMs: number, earlier: ViewReading | undefined, now: ViewReading): number | null {
  if (!earlier || !Number.isFinite(postedAtMs) || !Number.isFinite(now.impressions)) return null;
  const hoursBetween = (now.observedAtMs - earlier.observedAtMs) / 3_600_000;
  if (hoursBetween <= 0) return null;
  const speedPerHour = Math.max(0, now.impressions - earlier.impressions) / hoursBetween;
  return speedPerHour * effectiveHoursLeft((now.observedAtMs - postedAtMs) / 3_600_000);
}

/** Formats a prediction for logs, for example "120.0K". Unknown is "?". */
export function formatViewsToCome(v: number | null | undefined): string {
  return v == null ? "?" : formatCount(Math.round(v));
}
