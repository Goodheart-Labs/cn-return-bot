/**
 * cn-x-watch, the feed watcher of an X notewriter account (GOO-851). A daemon
 * on the services box, kept alive by systemd (ops/cn-x-watch.service), that
 * does for the WSDM Cup account what the X run on GitHub Actions does for the
 * first account, without waiting for a schedule.
 *
 * Every 30 seconds it
 *   1. sweeps the account's Claude tweets that waited 3 hours, and closes
 *      queued notes older than 12 hours, as the X run does,
 *   2. submits the notes Claude wrote (submit.ts).
 * Every 10 minutes, on the clock (:00, :10, ...), it also walks the account's
 * whole feed (GOO-874). It scores each post with its predicted views still to
 * come, from its view count now and in the walk before, and stores each
 * reading with its score (migration 203). Then, while the writing room allows
 * it (room.ts), it hands the best posts whose score clears a threshold to the
 * Claude note writer on ai-box. The threshold follows the writing limit and
 * how many posts arrived in the feed over the last 7 days (pick.ts).
 * Claude draws the same four A/B tests as for the first account: the model,
 * the examples, Jim's taste sentences and the research nudge. The runner on
 * ai-box finds the post's pipeline_runs row, and the note Claude saves there
 * is submitted by the next tick. The account's share of the notewriter plan
 * is its own (src/claude-notes/xShare.ts). While it is used up, new posts
 * wait.
 *
 * Once an hour it also stores the status X gives each of the account's public
 * notes, because the feedback job reads only the first account's notes.
 *
 * Until X admits the account it works in test mode: it writes as many test
 * notes as Jim allowed (room.ts), which X scores but never shows, and checks
 * once an hour whether X admitted it (admission.ts). When a batch of test
 * notes is written and X has scored all of them, Slack hears it once, with
 * the scores. Slack also hears once when X admits the account.
 *
 * The walk before is kept in memory. After a restart, the first walk reads it
 * from the database.
 *
 * The process works for the account named by X_ACCOUNT and refuses the first
 * account, whose keys cn-feed-views reads its feeds with. A failed tick does not crash the
 * daemon. When an hour passes without a good tick, Slack hears it once, and
 * again when ticks succeed again.
 *
 *   X_ACCOUNT=wsdm bun run src/x-watch/main.ts             the daemon
 *   X_ACCOUNT=wsdm bun run src/x-watch/main.ts --dry-run   one read-only look: the state, the room, the threshold and the posts it would hand over
 */

import "dotenv/config";
import { walkEligiblePages } from "../api/fetchEligiblePosts";
import { fetchNotesWritten } from "../api/fetchNotesWritten";
import { SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import { claudeUnavailableReason } from "../claude-notes/xShare";
import { syncAbTests } from "../pipeline/ab-testing/syncAbTests";
import { CLAUDE_CODE_BOT, CLAUDE_TWEET_MAX_WAIT_MINUTES, handTweetToClaude } from "../pipeline/orchestration/claudeTweets";
import { QUEUE_MAX_AGE_HOURS } from "../pipeline/orchestration/noteQueue";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";
import { type FeedReading, formatViewsToCome, readingsOf, scoreReadings, type ViewReading } from "../pipeline/utils/viewsToCome";
import { fetchClaimCheckHealth } from "../service/client";
import { describeSummary, isAdmitted, summariseTestNotes } from "./admission";
import {
  countOpenNotes, type FeedWalk, handledTweetIds, queuedNotes, readNoteRate, readScoreHistory, readWriterState, saveFeedWalk, stateKey, storedReadings,
  storeNoteStatuses,
} from "./db";
import { MIN_NOTE_RATE, pickPosts, type ScoredPost } from "./pick";
import { postsPerDay, type ScoreHistory, viewsThreshold } from "../pipeline/utils/viewsThreshold";
import { dailyLimit, inLimitCooldown, limitAfterSuccess, roomForChecks, TEST_NOTES_FOR_ADMISSION, type WriterState } from "./room";
import { submitQueuedNote } from "./submit";

type TestingState = Extract<WriterState, { kind: "testing" }>;

const TICK_MS = 30_000;
/** The view prediction was fitted on readings 10 minutes apart (GOO-834). */
const WALK_INTERVAL_MS = 10 * 60_000;
/** After a restart, the walk before is the newest stored one that started
 *  this long before the new walk, as in cn-feed-views. */
const EARLIER_WALK_MIN_GAP_MS = 5 * 60_000;
const EARLIER_WALK_MAX_GAP_MS = 20 * 60_000;
/** The score history is read again after this long. While it covers less than
 *  a day it is small, and every walk reads it again, so the first hours'
 *  thresholds keep up with the growing history. */
const HISTORY_REFRESH_MS = 60 * 60_000;
const SHORT_HISTORY_HOURS = 24;
const DRY_RUN_POSTS_SHOWN = 15;
/** How often the daemon asks X about admission, and later about its notes'
 *  statuses. */
const HOURLY_MS = 60 * 60_000;
/** How often the daemon asks X whether a finished batch of test notes is scored. */
const SCORE_CHECK_MS = 5 * 60_000;
const SILENCE_WARNING_MS = 60 * 60_000;
/** A run that never got as far as Claude, because the daemon stopped in
 *  between, is swept after this long, as in the X run. */
const STUCK_RUN_MINUTES = 30;
/** X's budget for the feed is 500 requests per 15 minutes per account, and
 *  only this daemon reads this account's feed. A walk of the feed takes 5
 *  requests in test mode and 8 outside it. This many are kept for the hourly
 *  admission check. */
const RATE_RESERVE = 10;

const account = currentXAccount();
if (account === "stilt") throw new Error("cn-x-watch must not work for the first account (stilt), whose notes the X run on GitHub Actions writes. Set X_ACCOUNT.");
const logger = new SupabaseLogger();
const tellSlack = (text: string) => postToSlack(NOTEWRITERS_SLACK_CHANNEL, `[cn-x-watch ${account}] ${text}`);

/** Every post of the account's feed, once each, in test mode until X admits
 *  the account. The request names no feed size, because X refuses one for the
 *  contest outside test mode (isAdmitted). In test mode X serves the small
 *  feed. */
async function walkFeed(testMode: boolean): Promise<FeedWalk> {
  const walkedAt = new Date();
  const readings = new Map<string, FeedReading>();
  for await (const page of walkEligiblePages(undefined, undefined, testMode)) {
    const observedAt = new Date();
    // X can repeat a post across pages. The first sighting counts.
    for (const post of page.posts) if (!readings.has(post.id)) readings.set(post.id, { post, observedAt });
    if (!page.isLastPage && page.rateRemaining !== null && page.rateRemaining < RATE_RESERVE) {
      console.warn(`[x-watch] X said ${page.rateRemaining} feed requests are left; this walk reads no more of the feed`);
      break;
    }
  }
  return { walkedAt, readings: [...readings.values()] };
}

/** The walk before, from memory, or from the database after a restart. */
async function readingsBefore(walk: FeedWalk, inMemory: Map<string, ViewReading> | null): Promise<Map<string, ViewReading>> {
  if (inMemory) return inMemory;
  const start = walk.walkedAt.getTime();
  return storedReadings(new Date(start - EARLIER_WALK_MAX_GAP_MS), new Date(start - EARLIER_WALK_MIN_GAP_MS));
}

const scoredPosts = (walk: FeedWalk, scores: Map<string, number | null>): ScoredPost[] =>
  walk.readings.flatMap(({ post }) => {
    const viewsToCome = scores.get(post.id);
    return viewsToCome == null ? [] : [{ post, viewsToCome }];
  });

type Threshold = { value: number | null; history: ScoreHistory; noteRate: number; wantedPerDay: number };

async function currentThreshold(state: WriterState, history: ScoreHistory): Promise<Threshold> {
  const noteRate = await readNoteRate();
  const wantedPerDay = postsPerDay(dailyLimit(state), noteRate, MIN_NOTE_RATE);
  return { value: viewsThreshold(history, wantedPerDay), history, noteRate, wantedPerDay };
}

const describeThreshold = (t: Threshold) =>
  `threshold ${t.value === null ? "not set yet" : formatViewsToCome(t.value)} views to come: ` +
  `${t.history.bestScores.length} posts arrived in ${t.history.hours.toFixed(1)} hours, ` +
  `and ${t.wantedPerDay.toFixed(0)} posts a day fill the limit at a note rate of ${Math.round(t.noteRate * 100)}%`;

async function handToClaude(scored: ScoredPost, threshold: number, testMode: boolean): Promise<void> {
  const { post } = scored;
  await logger.bulkInsertNewTweets([post]);
  const runId = await logger.createPipelineRun({ tweet_id: post.id, bot_name: CLAUDE_CODE_BOT });
  const logs = { x_watch: { test_mode: testMode, views_to_come: scored.viewsToCome, threshold } };
  await handTweetToClaude({ logger, runId, post, picks: {}, logs, claudeUnavailable: null });
}

/** Submits the queued notes one by one, until X refuses one for the daily
 *  limit. The writing limit is updated as notes go out. */
async function submitQueue(state: WriterState): Promise<void> {
  if (inLimitCooldown(state, new Date())) return;
  let submittedLast24h = state.kind === "admitted" ? state.submittedLast24h : 0;
  let writingLimit = state.kind === "admitted" ? state.writingLimit : 0;
  for (const note of await queuedNotes()) {
    const outcome = await submitQueuedNote(note, state.kind === "testing", logger);
    if (state.kind === "testing") continue;
    if (outcome === "daily_limit") {
      console.log(`[x-watch] X refused a note for the daily limit after ${submittedLast24h} notes in 24 hours`);
      await logger.setPipelineState(stateKey("writing_limit"), String(submittedLast24h));
      await logger.setPipelineState(stateKey("limit_hit_at"), new Date().toISOString());
      return;
    }
    if (outcome !== "submitted") continue;
    submittedLast24h++;
    writingLimit = limitAfterSuccess(writingLimit, submittedLast24h);
    await logger.setPipelineState(stateKey("writing_limit"), String(writingLimit));
  }
}

/** Once an hour while the account is not admitted: asks X whether it is now. */
async function checkAdmission(): Promise<void> {
  if (!(await isAdmitted())) return;
  await logger.setPipelineState(stateKey("admitted_at"), new Date().toISOString());
  await tellSlack("X admitted the account as an AI Note Writer. From now on its notes are public, and it checks posts while its writing limit has room.");
}

/** Tells Slack once per batch when every test note it allowed is written and
 *  scored. `test_notes_announced` keeps the allowance last announced. */
async function announceScoredBatch(state: TestingState): Promise<void> {
  const { testNotesSubmitted, testNoteAllowance } = state;
  if (testNoteAllowance === 0 || testNotesSubmitted < testNoteAllowance) return;
  if ((await logger.getPipelineState(stateKey("test_notes_announced"))) === String(testNoteAllowance)) return;
  const summary = summariseTestNotes(await fetchNotesWritten({ testMode: true, maxNotes: Math.min(testNotesSubmitted, TEST_NOTES_FOR_ADMISSION) }));
  if (summary.unscored > 0) return;
  await tellSlack(
    `All ${testNotesSubmitted} test notes it was allowed are written and scored. ${describeSummary(summary)} `
      + `\`bun run x-watch-test-notes\` lists them, and \`bun run x-watch-allow-test-notes <n>\` lets it write n more.`,
  );
  await logger.setPipelineState(stateKey("test_notes_announced"), String(testNoteAllowance));
}

type Watch = {
  lastHourlyAt: number;
  lastScoreCheckAt: number;
  lastGoodTickAt: number;
  warned: boolean;
  nextWalkAt: number;
  lastReadings: Map<string, ViewReading> | null;
  history: { readAt: number; value: ScoreHistory } | null;
};

const nextSlot = (ms: number) => Math.floor(ms / WALK_INTERVAL_MS) * WALK_INTERVAL_MS + WALK_INTERVAL_MS;

async function scoreHistory(watch: Watch): Promise<ScoreHistory> {
  const cached = watch.history;
  if (cached && Date.now() - cached.readAt < HISTORY_REFRESH_MS && cached.value.hours >= SHORT_HISTORY_HOURS) return cached.value;
  watch.history = { readAt: Date.now(), value: await readScoreHistory(new Date()) };
  return watch.history.value;
}

/** Walks the feed, stores the scored readings, and hands the best new posts
 *  that clear the threshold to Claude while the room allows it. */
async function walkAndHandOver(watch: Watch): Promise<void> {
  const state = await readWriterState(logger);
  const testMode = state.kind === "testing";
  const walk = await walkFeed(testMode);
  const scores = scoreReadings(walk.readings, await readingsBefore(walk, watch.lastReadings));
  watch.lastReadings = readingsOf(walk.readings);
  await saveFeedWalk(walk, scores);
  const scored = scoredPosts(walk, scores);
  const threshold = await currentThreshold(state, await scoreHistory(watch));
  const room = roomForChecks(state, await countOpenNotes(), new Date());
  console.log(`[x-watch] walk: ${walk.readings.length} posts, ${scored.length} scored; ${describeThreshold(threshold)}; room ${room}`);
  if (threshold.value === null || room === 0) return;
  const picked = pickPosts(scored, await handledTweetIds(scored.map((s) => s.post.id)), room, threshold.value);
  if (!picked.length) return;
  // A post handed over while Claude is unavailable would fail for good, so
  // these posts wait for a later walk instead. The X share is read only when
  // there is a new post, because it logs every reading.
  if (await claudeUnavailableReason()) return;
  // The claim-check service builds each post's input. A restart by a deploy
  // must not fail the posts, so the walk fails and the next one tries again.
  await fetchClaimCheckHealth();
  for (const s of picked) await handToClaude(s, threshold.value, testMode);
  console.log(`[x-watch] handed ${picked.length} post(s) to Claude${testMode ? " in test mode" : ""}: ${picked.map((s) => formatViewsToCome(s.viewsToCome)).join(", ")} views to come`);
}

async function tick(watch: Watch): Promise<void> {
  await logger.sweepStuckRuns({ olderThanMinutes: STUCK_RUN_MINUTES, claudeOlderThanMinutes: CLAUDE_TWEET_MAX_WAIT_MINUTES });
  await logger.expireQueuedRuns(QUEUE_MAX_AGE_HOURS);
  const before = await readWriterState(logger);
  if (Date.now() - watch.lastHourlyAt >= HOURLY_MS) {
    watch.lastHourlyAt = Date.now();
    if (before.kind === "testing") await checkAdmission();
    else console.log(`[x-watch] stored ${await storeNoteStatuses(await fetchNotesWritten())} changed note status(es)`);
  }
  if (before.kind === "testing" && Date.now() - watch.lastScoreCheckAt >= SCORE_CHECK_MS) {
    watch.lastScoreCheckAt = Date.now();
    await announceScoredBatch(before);
  }
  await submitQueue(await readWriterState(logger));
  if (Date.now() < watch.nextWalkAt) return;
  // A walk that fails waits for the next slot, so X is not asked every tick.
  watch.nextWalkAt = nextSlot(Date.now());
  await walkAndHandOver(watch);
}

async function runDaemon(): Promise<never> {
  const watch: Watch = {
    lastHourlyAt: 0, lastScoreCheckAt: 0, lastGoodTickAt: Date.now(), warned: false,
    nextWalkAt: nextSlot(Date.now()), lastReadings: null, history: null,
  };
  // The notewriter page counts runs from before a test existed as its default
  // arm, so every test of AB_TESTS must be in x_ab_tests. A deploy restarts
  // the daemon, so syncing at start catches every new test.
  await syncAbTests().catch((err) => console.error("[x-watch] could not sync the A/B tests:", err));
  console.log(`[x-watch] started for X account ${account}`);
  for (;;) {
    const startedAt = Date.now();
    try {
      await tick(watch);
      if (watch.warned) await tellSlack("Its ticks succeed again.");
      watch.lastGoodTickAt = Date.now();
      watch.warned = false;
    } catch (err) {
      console.error("[x-watch] tick failed:", err);
      if (!watch.warned && Date.now() - watch.lastGoodTickAt >= SILENCE_WARNING_MS) {
        await tellSlack(`No tick has succeeded since ${new Date(watch.lastGoodTickAt).toISOString()}. The last one failed with: ${err instanceof Error ? err.message : String(err)}`).catch((slackErr) => console.error("[x-watch] Slack failed:", slackErr));
        watch.warned = true;
      }
    }
    await Bun.sleep(Math.max(0, startedAt + TICK_MS - Date.now()));
  }
}

async function dryRun(): Promise<void> {
  const state = await readWriterState(logger);
  const openNotes = await countOpenNotes();
  const room = roomForChecks(state, openNotes, new Date());
  console.log(`[x-watch] state ${JSON.stringify(state)}, ${openNotes} open, room ${room}, admitted now: ${await isAdmitted()}`);
  const walk = await walkFeed(state.kind === "testing");
  const scores = scoreReadings(walk.readings, await readingsBefore(walk, null));
  const scored = scoredPosts(walk, scores);
  const threshold = await currentThreshold(state, await readScoreHistory(new Date()));
  console.log(`[x-watch] the feed has ${walk.readings.length} posts, ${scored.length} scored against the last stored walk; ${describeThreshold(threshold)}`);
  const handled = await handledTweetIds(scored.map((s) => s.post.id));
  const best = pickPosts(scored, handled, DRY_RUN_POSTS_SHOWN, 0);
  console.log(`[x-watch] the best unhandled posts; those at the threshold or above go to Claude while there is room:`);
  for (const s of best) console.log(`  https://x.com/i/status/${s.post.id} posted ${s.post.created_at}, ${formatViewsToCome(s.viewsToCome)} to come`);
  console.log(`[x-watch] Claude: ${(await claudeUnavailableReason()) ?? "available"}`);
}

if (process.argv.includes("--dry-run")) await dryRun();
else await runDaemon();
