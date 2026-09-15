/**
 * What would the last week have looked like under the pacing alarm?
 *
 * READ-ONLY against prod. It loads the week's cost rows and items, rebuilds
 * each feed post's real start time, duration and cost, and then replays each
 * UTC day the way src/everything/pacing.ts and migration 097 run it: a run
 * starts at the first minute tick after the alarm the previous run set, plus
 * the minute and a half a fresh run takes to start; it processes one post,
 * then sets the next alarm from the money left, the hours left and the mean
 * cost at that moment; a run that finds nothing waiting sets the idle alarm.
 * The real reader-requested spend is added at its real time, and posts that
 * did not start by midnight carry into the next day. The mean post cost the
 * rule sees is the real one: the mean over feed posts finished in the 48
 * hours before the run (7 days when fewer than 5).
 *
 * It prints, per day, the real and the replayed spend per UTC hour, so the
 * burst and its replacement sit next to each other. Both rows include the
 * reader-requested spend at its real time. A post's cost lands in the hour it
 * starts, and a post that would have hit the cap is charged only what was
 * left. Nothing is written.
 *
 *   bun run src/scripts_jim/2026_09_14_continuous_pacing/replayPacing.ts [days]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  computeNextRun,
  DEFAULT_MEAN_POST_COST_USD,
  MEAN_COST_FALLBACK_HOURS,
  MEAN_COST_MIN_POSTS,
  MEAN_COST_WINDOW_HOURS,
  nextAlarm,
  type FeedPacingSnapshot,
} from "../../everything/pacing";
import { FEED_BUDGET_USD } from "../../everything/spendCap";

const DAYS = Number(process.argv[2] ?? 7);
const MINUTE_MS = 60_000;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const REQUESTED_TIER = 2;
/** From the alarm to the pipeline actually running: pg_cron's minute tick,
 *  GitHub picking the dispatch up, and the runner's setup steps. Measured on
 *  the last successful production run before this change. */
const RUN_SETUP_MS = 90_000;
/** A post cut short one day and resumed the next has a real span of days.
 *  The replay treats such a post as if it had run in one go, capped here. */
const MAX_POST_DURATION_MS = 3 * HOUR_MS;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

interface Post {
  id: string;
  priority: number;
  start: number;
  end: number;
  cost: number;
}

/** Every item that spent money in the window, with its real start (first
 *  cost row, which is the extraction row), end (processed_at, or the last
 *  cost row) and total cost. */
async function loadPosts(since: Date): Promise<Post[]> {
  const runs = await fetchAll<{ cost: number | null; item_id: string | null; claim_id: string | null; created_at: string }>((a, b) =>
    db.from("everything_pipeline_runs").select("cost, item_id, claim_id, created_at").gte("created_at", since.toISOString()).range(a, b),
  );
  const claimIds = [...new Set(runs.flatMap((r) => (r.claim_id ? [r.claim_id] : [])))];
  const claimItem = new Map<string, string>();
  for (let i = 0; i < claimIds.length; i += 500) {
    const { data, error } = await db.from("everything_claims").select("id, item_id").in("id", claimIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) claimItem.set(c.id, c.item_id);
  }
  const byItem = new Map<string, { start: number; end: number; cost: number }>();
  for (const r of runs) {
    const item = r.item_id ?? claimItem.get(r.claim_id!);
    if (!item) continue;
    const t = Date.parse(r.created_at);
    const p = byItem.get(item) ?? { start: t, end: t, cost: 0 };
    p.start = Math.min(p.start, t);
    p.end = Math.max(p.end, t);
    p.cost += r.cost ?? 0;
    byItem.set(item, p);
  }
  const { data: items, error } = await db.from("everything_items").select("id, priority, processed_at").in("id", [...byItem.keys()]);
  if (error) throw new Error(error.message);
  return (items ?? [])
    .map((i) => {
      const p = byItem.get(i.id)!;
      return { id: i.id, priority: i.priority, start: p.start, end: Math.max(p.end, i.processed_at ? Date.parse(i.processed_at) : p.end), cost: p.cost };
    })
    .sort((a, b) => a.start - b.start);
}

/** The real mean over feed posts finished in the window before `at`, the way
 *  everything_feed_pacing computes it. */
function realMean(posts: Post[], at: number): { mean: number | null; n: number; hours: number } {
  const finished = (hours: number) => posts.filter((p) => p.priority < REQUESTED_TIER && p.end <= at && p.end >= at - hours * HOUR_MS);
  let sample = finished(MEAN_COST_WINDOW_HOURS);
  let hours = MEAN_COST_WINDOW_HOURS;
  if (sample.length < MEAN_COST_MIN_POSTS) {
    sample = finished(MEAN_COST_FALLBACK_HOURS);
    hours = MEAN_COST_FALLBACK_HOURS;
  }
  const mean = sample.length ? sample.reduce((s, p) => s + p.cost, 0) / sample.length : null;
  return { mean, n: sample.length, hours };
}

function hourRow(label: string, perHour: number[]): string {
  return `${label.padEnd(12)}${perHour.map((c) => (c >= 0.005 ? c.toFixed(1).padStart(5) : "    ·")).join("")}  = ${perHour.reduce((a, b) => a + b, 0).toFixed(2).padStart(6)}`;
}

function main(posts: Post[], firstDay: number, lastDay: number): void {
  const reader = posts.filter((p) => p.priority >= REQUESTED_TIER);
  const feed = posts.filter((p) => p.priority < REQUESTED_TIER);
  console.log(`replaying ${DAYS} days · ${feed.length} feed posts, ${reader.length} reader posts · feed budget $${FEED_BUDGET_USD} · default mean $${DEFAULT_MEAN_POST_COST_USD}\n`);
  console.log(`hours       ${Array.from({ length: 24 }, (_, h) => String(h).padStart(5)).join("")}`);

  // Posts waiting to be replayed, in real start order; a day's leftovers carry over.
  const waiting = [...feed];
  // Replayed starts, for the mean the rule would have seen.
  const replayed: Post[] = [];
  // The alarm the previous run set. Null means never set, so the first run
  // starts at once, which is how the pipeline bootstraps.
  let alarm: number | null = null;
  let runnerBusyUntil = 0;
  const nextTick = (t: number) => Math.ceil(t / MINUTE_MS) * MINUTE_MS;

  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const dayEnd = day + DAY_MS;
    const realHours = new Array<number>(24).fill(0);
    const simHours = new Array<number>(24).fill(0);
    const hourOf = (t: number) => Math.floor(((t - day) % DAY_MS) / HOUR_MS);
    for (const p of feed) if (p.start >= day && p.start < dayEnd) realHours[hourOf(p.start)] += p.cost;
    // Reader-requested spend is outside the pacing and happens at its real
    // time in both rows, so the two rows differ only by the feed posts.
    const readerToday = reader.filter((p) => p.start >= day && p.start < dayEnd);
    for (const p of readerToday) {
      realHours[hourOf(p.start)] += p.cost;
      simHours[hourOf(p.start)] += p.cost;
    }
    // What the UTC day of `t` has cost by `t`. A run that ends after midnight
    // sees the new day's total, exactly as the real snapshot does.
    const spentBy = (t: number) => {
      const startOfDay = Math.floor(t / DAY_MS) * DAY_MS;
      return [...replayed, ...reader].filter((p) => p.start >= startOfDay && p.start <= t).reduce((s, p) => s + p.cost, 0);
    };

    let started = 0;
    let behind = 0;
    let idle = 0;
    let capped = 0;
    for (;;) {
      const runStart = nextTick(Math.max(alarm ?? day, runnerBusyUntil, day)) + RUN_SETUP_MS;
      if (runStart >= dayEnd) break;
      // Only posts that really existed by then are candidates: a post cannot
      // be replayed before it was published. Real start stands in for that.
      const next = waiting.find((p) => p.start <= runStart);
      let runEnd = runStart;
      let processed = false;
      if (spentBy(runStart) >= FEED_BUDGET_USD) {
        capped++;
      } else if (!next) {
        idle++;
      } else {
        waiting.splice(waiting.indexOf(next), 1);
        const duration = Math.min(Math.max(next.end - next.start, MINUTE_MS), MAX_POST_DURATION_MS);
        // The real per-claim cap stops a post once the feed budget is spent;
        // the rest of its cost would have waited for another day.
        const cost = Math.min(next.cost, Math.max(0, FEED_BUDGET_USD - spentBy(runStart)));
        replayed.push({ ...next, start: runStart, end: runStart + duration, cost });
        runEnd = runStart + duration;
        simHours[Math.min(23, hourOf(runStart))] += cost;
        started++;
        processed = true;
      }
      runnerBusyUntil = runEnd;
      // The alarm is set at the end of the run, from what the day has cost by then.
      const { mean, n, hours } = realMean([...replayed, ...reader], runEnd);
      const lastStart = replayed.at(-1)?.start ?? null;
      const snapshot: FeedPacingSnapshot = {
        dbNow: new Date(runEnd),
        spentTodayUsd: spentBy(runEnd),
        meanPostCostUsd: mean,
        samplePosts: n,
        sampleHours: hours,
        lastFeedStartedAt: lastStart ? new Date(lastStart) : null,
      };
      const alarmSet = nextAlarm(computeNextRun(snapshot, FEED_BUDGET_USD), snapshot, processed);
      if (processed && alarmSet.at.getTime() <= runEnd) behind++;
      alarm = alarmSet.at.getTime();
    }
    const label = new Date(day).toISOString().slice(5, 10);
    console.log(hourRow(`${label} real`, realHours));
    console.log(hourRow(`${label} paced`, simHours));
    console.log(`         ${started} started, ${behind} of them outlasted their interval, ${idle} idle runs, ${capped} runs stopped by the cap, ${waiting.filter((p) => p.start < dayEnd).length} carried over\n`);
  }
}

const since = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - DAYS * DAY_MS);
const posts = await loadPosts(new Date(since.getTime() - MEAN_COST_FALLBACK_HOURS * HOUR_MS));
main(
  posts.filter((p) => p.start >= since.getTime()),
  since.getTime(),
  Math.floor(Date.now() / DAY_MS) * DAY_MS - DAY_MS,
);
