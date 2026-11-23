/**
 * cn-x-watch, the feed watcher of an X notewriter account (GOO-851). A daemon
 * on the services box, kept alive by systemd (ops/cn-x-watch.service), that
 * does for the WSDM Cup account what the X run on GitHub Actions does for the
 * first account, without waiting for a schedule.
 *
 * Every 30 seconds it
 *   1. sweeps the account's Claude tweets that waited 3 hours, and closes
 *      queued notes older than 12 hours, as the X run does,
 *   2. submits the notes Claude wrote (submit.ts),
 *   3. and, while the writing room allows it (room.ts), reads the account's
 *      small feed and hands each new post to the Claude note writer on ai-box.
 * Claude draws the same four A/B tests as for the first account: the model,
 * the examples, Jim's taste sentences and the research nudge. The runner on
 * ai-box finds the post's pipeline_runs row, and the note Claude saves there
 * is submitted by the next tick, usually a minute or two after the post
 * appeared in the feed. The account's share of the notewriter plan is its own
 * (src/claude-notes/xShare.ts). While it is used up, new posts wait.
 *
 * Until X admits the account it works in test mode: it writes 50 test notes,
 * which X scores but never shows, and then checks once an hour whether X
 * admitted it (admission.ts). Slack hears once when the 50 test notes are
 * scored and once when X admits the account.
 *
 * The process works for the account named by X_ACCOUNT and refuses the first
 * account, whose notes the X run writes. A failed tick does not crash the
 * daemon. When an hour passes without a good tick, Slack hears it once, and
 * again when ticks succeed again.
 *
 *   X_ACCOUNT=wsdm bun run src/x-watch/main.ts
 */

import "dotenv/config";
import { walkEligiblePages, type Post } from "../api/fetchEligiblePosts";
import { fetchNotesWritten } from "../api/fetchNotesWritten";
import { SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import { claudeUnavailableReason } from "../claude-notes/xShare";
import { CLAUDE_CODE_BOT, CLAUDE_TWEET_MAX_WAIT_MINUTES, handTweetToClaude } from "../pipeline/orchestration/claudeTweets";
import { QUEUE_MAX_AGE_HOURS } from "../pipeline/orchestration/noteQueue";
import { buildPostSelection } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { NOTEWRITERS_SLACK_CHANNEL, postToSlack } from "../pipeline/utils/slack";
import { fetchClaimCheckHealth } from "../service/client";
import { describeSummary, isAdmitted, summariseTestNotes } from "./admission";
import { countOpenNotes, handledTweetIds, queuedNotes, readWriterState, stateKey } from "./db";
import { inLimitCooldown, limitAfterSuccess, pickNewPosts, roomForChecks, TEST_NOTES_FOR_ADMISSION, type WriterState } from "./room";
import { submitQueuedNote } from "./submit";

const TICK_MS = 30_000;
const ADMISSION_CHECK_MS = 60 * 60_000;
const SILENCE_WARNING_MS = 60 * 60_000;
/** A run that never got as far as Claude, because the daemon stopped in
 *  between, is swept after this long, as in the X run. */
const STUCK_RUN_MINUTES = 30;
/** X's budget for the feed is 500 requests per 15 minutes per account, and
 *  only this daemon reads this account's feed. A walk of the small feed takes
 *  5 requests. This many are kept for the hourly admission check. */
const RATE_RESERVE = 10;

const account = currentXAccount();
if (account === "stilt") throw new Error("cn-x-watch must not work for the first account (stilt), whose notes the X run on GitHub Actions writes. Set X_ACCOUNT.");
const logger = new SupabaseLogger();
const tellSlack = (text: string) => postToSlack(NOTEWRITERS_SLACK_CHANNEL, `[cn-x-watch ${account}] ${text}`);

/** Every post of the small feed, in test mode until X admits the account. */
async function readSmallFeed(testMode: boolean): Promise<Post[]> {
  const posts: Post[] = [];
  for await (const page of walkEligiblePages(buildPostSelection("small"), undefined, testMode)) {
    posts.push(...page.posts);
    if (!page.isLastPage && page.rateRemaining !== null && page.rateRemaining < RATE_RESERVE) {
      console.warn(`[x-watch] X said ${page.rateRemaining} feed requests are left; this tick reads no more of the feed`);
      break;
    }
  }
  return posts;
}

async function handToClaude(post: Post, testMode: boolean): Promise<void> {
  await logger.bulkInsertNewTweets([post]);
  const runId = await logger.createPipelineRun({ tweet_id: post.id, bot_name: CLAUDE_CODE_BOT });
  await handTweetToClaude({ logger, runId, post, picks: {}, logs: { x_watch: { test_mode: testMode } }, claudeUnavailable: null });
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

/** Once an hour while the account is not admitted: asks X whether it is now,
 *  and tells Slack once when the 50 test notes are all scored. */
async function checkAdmission(state: Extract<WriterState, { kind: "testing" }>): Promise<void> {
  if (await isAdmitted()) {
    await logger.setPipelineState(stateKey("admitted_at"), new Date().toISOString());
    await tellSlack("X admitted the account as an AI Note Writer. From now on its notes are public, and it checks posts while its writing limit has room.");
    return;
  }
  if (state.testNotesSubmitted < TEST_NOTES_FOR_ADMISSION || (await logger.getPipelineState(stateKey("test_notes_announced")))) return;
  const summary = summariseTestNotes(await fetchNotesWritten({ testMode: true, maxNotes: TEST_NOTES_FOR_ADMISSION }));
  if (summary.unscored > 0) return;
  await tellSlack(`All ${TEST_NOTES_FOR_ADMISSION} test notes are scored. ${describeSummary(summary)} \`bun run x-watch-test-notes\` lists them.`);
  await logger.setPipelineState(stateKey("test_notes_announced"), new Date().toISOString());
}

type Watch = { lastAdmissionCheckAt: number; lastGoodTickAt: number; warned: boolean };

async function tick(watch: Watch): Promise<void> {
  await logger.sweepStuckRuns({ olderThanMinutes: STUCK_RUN_MINUTES, claudeOlderThanMinutes: CLAUDE_TWEET_MAX_WAIT_MINUTES });
  await logger.expireQueuedRuns(QUEUE_MAX_AGE_HOURS);
  const before = await readWriterState(logger);
  if (before.kind === "testing" && Date.now() - watch.lastAdmissionCheckAt >= ADMISSION_CHECK_MS) {
    watch.lastAdmissionCheckAt = Date.now();
    await checkAdmission(before);
  }
  await submitQueue(await readWriterState(logger));

  const state = await readWriterState(logger);
  const room = roomForChecks(state, await countOpenNotes(), new Date());
  if (room === 0) return;
  const testMode = state.kind === "testing";
  const posts = await readSmallFeed(testMode);
  const picked = pickNewPosts(posts, await handledTweetIds(posts.map((post) => post.id)), room);
  if (!picked.length) return;
  // A post handed over while Claude is unavailable would fail for good, so
  // these posts wait for a later tick instead. The X share is read only when
  // there is a new post, because it logs every reading.
  if (await claudeUnavailableReason()) return;
  // The claim-check service builds each post's input. A restart by a deploy
  // must not fail the posts, so the tick fails and the next one tries again.
  await fetchClaimCheckHealth();
  for (const post of picked) await handToClaude(post, testMode);
  console.log(`[x-watch] handed ${picked.length} new post(s) to Claude${testMode ? " in test mode" : ""}; room was ${room}`);
}

async function runDaemon(): Promise<never> {
  const watch: Watch = { lastAdmissionCheckAt: 0, lastGoodTickAt: Date.now(), warned: false };
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

await runDaemon();
