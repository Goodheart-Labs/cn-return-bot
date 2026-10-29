import type { NoteDay, OriginDay } from "@cn/core/notewriter";

/* The bars of the "Notes over time" chart. The database counts per UTC day,
 * and a weekly chart adds the days of each week together. */

export type Granularity = "daily" | "weekly";

/** One bar: the notes by status, and the runs that never submitted a note. */
export interface NoteBucket {
  key: string;
  start: Date;
  helpful: number;
  notHelpful: number;
  needsRatings: number;
  /** Runs that were rejected, filtered out or failed, or whose note waits. */
  notSubmittedRuns: number;
}

/** One bar of "% of all notes": the notes rated helpful on X, by who wrote
 *  them. The human count is what is left, never below zero. */
export interface OriginBucket {
  key: string;
  start: Date;
  ours: number;
  otherAi: number;
  human: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The day a bar starts, as YYYY-MM-DD in UTC: the day itself, or the Monday
 *  that starts its ISO week. */
export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === "daily") return day;
  const date = new Date(`${day}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - daysSinceMonday * ONE_DAY_MS).toISOString().slice(0, 10);
}

/** Leaves out the week that is still running. Its bar covers only the days so
 *  far, so it would sit far below the others until Sunday. */
function withoutRunningWeek<T extends { key: string }>(buckets: T[], granularity: Granularity, today: string): T[] {
  if (granularity === "daily") return buckets;
  const runningWeek = bucketKey(today, "weekly");
  return buckets.filter((bucket) => bucket.key !== runningWeek);
}

function groupDays<D extends { day: string }, B extends { key: string }>(days: D[], granularity: Granularity, today: string, empty: (key: string) => B, add: (bucket: B, day: D) => void): B[] {
  const byKey = new Map<string, B>();
  for (const day of days) {
    const key = bucketKey(day.day, granularity);
    let bucket = byKey.get(key);
    if (!bucket) byKey.set(key, (bucket = empty(key)));
    add(bucket, day);
  }
  return withoutRunningWeek([...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)), granularity, today);
}

const startOf = (key: string) => new Date(`${key}T00:00:00Z`);

export function noteBuckets(days: NoteDay[], granularity: Granularity, today: string): NoteBucket[] {
  return groupDays(
    days,
    granularity,
    today,
    (key) => ({ key, start: startOf(key), helpful: 0, notHelpful: 0, needsRatings: 0, notSubmittedRuns: 0 }),
    (bucket, day) => {
      bucket.helpful += day.helpful;
      bucket.notHelpful += day.notHelpful;
      bucket.needsRatings += day.needsRatings;
      bucket.notSubmittedRuns += Math.max(0, day.runs - day.submittedRuns);
    },
  );
}

export function originBuckets(days: OriginDay[], granularity: Granularity, today: string): OriginBucket[] {
  const totals = new Map<string, number>();
  const buckets = groupDays(
    days,
    granularity,
    today,
    (key) => ({ key, start: startOf(key), ours: 0, otherAi: 0, human: 0 }),
    (bucket, day) => {
      bucket.ours += day.ours;
      bucket.otherAi += day.otherAi;
      totals.set(bucket.key, (totals.get(bucket.key) ?? 0) + day.total);
    },
  );
  for (const bucket of buckets) bucket.human = Math.max(0, (totals.get(bucket.key) ?? 0) - bucket.ours - bucket.otherAi);
  return buckets;
}

/** A bar's label: "Oct 27" for a day, "Wk of Oct 27" for a week. */
export function bucketLabel(start: Date, granularity: Granularity): string {
  const day = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return granularity === "daily" ? day : `Wk of ${day}`;
}
