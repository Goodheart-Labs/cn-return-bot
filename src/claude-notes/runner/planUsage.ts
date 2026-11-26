/* The Claude plan the runner spends, and whether it may start Claudes.
 *
 * Every 5 minutes the runner reads the plan's weekly usage, stores it for the
 * dashboard and the X share, and turns it into its pace: how often it wants a
 * feed post, and whether it takes reader requests (GOO-587, GOO-724). It tells
 * Slack when its login is dead or the usage cannot be read (GOO-819). */

import { existsSync } from "fs";
import { fetchUsageSnapshot } from "../../everything/db";
import { computeClaudePacing, describeClaudePacing, MAX_WEEKLY_USAGE_PERCENT } from "../../everything/usagePacing";
import { problemCleared, problemStarted } from "../alerts";
import { claudeQueue, type ClaudePace } from "../queue";
import { recordUsage } from "../store";
import { readUsage, type UsageReading } from "../usage";
import { renewClaudeLogin } from "./session";

/** The usage endpoint is rate limited. */
const USAGE_READ_EVERY_MS = 5 * 60_000;
/** Slack hears of a usage endpoint that fails for this long. Without a
 *  reading the runner starts nothing. */
const USAGE_ALERT_AFTER_MS = 30 * 60_000;

/** The pause switch. While it exists, the runner starts nothing. */
const PAUSE_FILE = process.env.CN_PAUSE_FILE ?? "/srv/ai-box/PAUSE";
/** The deploy's freeze (cn-notes-runner/deploy.sh in the devbox repository). While this file exists the
 *  runner starts no Claude, and the work that comes in waits in the database.
 *  Once nothing is at work any more, the deploy updates the code, removes the
 *  file and restarts the runner, which then starts the waiting work. */
export const DRAIN_FILE = process.env.CN_DRAIN_FILE ?? "/var/lib/cn-notes-deploy/draining";
/** A second runner on another Claude plan (CN_POSTS_ONLY=1, with its own
 *  CN_NOTEWRITER), such as hq's, writes Common Notes posts and nothing else.
 *  Its plan's readings stay out of the usage table, whose pacing and X share
 *  are claude-ai-box's. */
export const POSTS_ONLY = process.env.CN_POSTS_ONLY === "1";

let usage: UsageReading | null = null;
let usageReadAt = 0;
let usageGoodAt = Date.now();

/** The plan's weekly usage at which this runner starts nothing new:
 *  CN_STOP_AT_PERCENT for a second runner on a plan its owner also uses. */
function stopAtPercent(): number {
  const set = process.env.CN_STOP_AT_PERCENT;
  return set ? Math.min(Number(set), MAX_WEEKLY_USAGE_PERCENT) : MAX_WEEKLY_USAGE_PERCENT;
}

const isUnauthorized = (err: unknown) => (err as Error).message.includes(" 401");

async function readUsageRenewingLogin(): Promise<UsageReading> {
  try {
    return await readUsage();
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    renewClaudeLogin();
    return readUsage();
  }
}

/** Tells Slack when the login is dead or the usage cannot be read, and again
 *  when it works again. */
async function alertAboutUsage(err: unknown) {
  if (err === null) {
    usageGoodAt = Date.now();
    await problemCleared("login", "The Claude login works again.");
    return problemCleared("usage", "The usage of the Claude plan can be read again.");
  }
  if (isUnauthorized(err)) {
    return problemStarted("login", "The Claude login no longer works, even after a renewal, so the runner starts no Claude. Someone has to log in again (src/claude-notes/runner/README.md).");
  }
  if (Date.now() - usageGoodAt > USAGE_ALERT_AFTER_MS) {
    await problemStarted("usage", `The runner has not read the usage of its Claude plan for 30 minutes, so it starts no Claude. The last error: ${(err as Error).message}`);
  }
}

/** Turns the plan's weekly usage into Claude's pace (GOO-724, GOO-791).
 *  Below the target, Claude wants a feed post as often as the usage pacing
 *  allows, and it takes reader requests. At the target it takes reader
 *  requests only. At the stop, while paused, or without a reading, it takes
 *  nothing. A v1 host tells the server as its subscription, and a v2 host
 *  keeps the pace itself (queue.ts). */
async function updatePace(weekly: number | null, paused: boolean): Promise<void> {
  const setPace = (pace: ClaudePace) => claudeQueue().setPace(pace);
  if (paused || weekly === null || weekly >= stopAtPercent()) {
    await setPace({ feedEveryMinutes: null, readerRequests: false });
    console.log(`Pace: nothing, because ${paused ? "the runner is paused" : weekly === null ? "the usage is unknown" : `the plan is at ${weekly}%`}`);
    return;
  }
  // A second runner (CN_EVERY_MINUTES) asks for a feed post at a fixed
  // interval, because the pacing below reads claude-ai-box's plan, not this one.
  // It takes reader requests only with CN_READER_REQUESTS=1.
  const fixedMinutes = Number(process.env.CN_EVERY_MINUTES) || (POSTS_ONLY ? 10 : 0);
  if (fixedMinutes > 0) {
    const requests = process.env.CN_READER_REQUESTS === "1";
    await setPace({ feedEveryMinutes: fixedMinutes, readerRequests: requests });
    console.log(`Pace: a feed post every ${fixedMinutes} minutes, ${requests ? "and" : "no"} reader requests (plan at ${weekly}%)`);
    return;
  }
  const snapshot = await fetchUsageSnapshot();
  const pacing = computeClaudePacing(snapshot);
  if (pacing) console.log(describeClaudePacing(pacing, snapshot));
  const everyMinutes = pacing && Number.isFinite(pacing.intervalMs) ? Math.max(1, Math.ceil(pacing.intervalMs / 60_000)) : null;
  await setPace({ feedEveryMinutes: everyMinutes, readerRequests: true });
  console.log(`Pace: ${everyMinutes ? `a feed post every ${everyMinutes} minutes` : "no feed posts"}, and reader requests`);
}

/** The latest reading, at most 5 minutes old. A failed read keeps the last
 *  one, and with no reading at all nothing starts. */
export async function weeklyUsage(): Promise<number | null> {
  if (Date.now() - usageReadAt > USAGE_READ_EVERY_MS) {
    usageReadAt = Date.now();
    try {
      usage = await readUsageRenewingLogin();
      if (!POSTS_ONLY) await recordUsage(usage);
      await alertAboutUsage(null);
    } catch (err) {
      console.error(`Could not read the usage: ${(err as Error).message}`);
      await alertAboutUsage(err);
    }
    await updatePace(usage?.weekly ?? null, existsSync(PAUSE_FILE));
  }
  return usage?.weekly ?? null;
}

/** Whether the runner may start Claudes now: not paused, not frozen for a
 *  deploy, and the plan under its stop. */
export async function mayStartClaudes(): Promise<boolean> {
  if (existsSync(PAUSE_FILE) || existsSync(DRAIN_FILE)) return false;
  const weekly = await weeklyUsage();
  return weekly !== null && weekly < stopAtPercent();
}
