/**
 * Tweets for the Claude Code note writer (GOO-527).
 *
 * The bot A/B test has a variant `claude-code`. A tweet that draws it is not
 * checked by the pipeline. Instead the X run asks the claim-check service to
 * build the tweet's input (src/pipeline/input/claudeTweetInput.ts) and leaves
 * the tweet's pipeline_runs row open, at the final stage `claude_waiting`.
 * The Claude note writer's runner (src/claude-notes/jobs/tweet.ts) finds the row and
 * starts one Claude Opus for it. That Claude saves its note on the same row and
 * puts it in the note queue (noteQueue.ts). The X run that handed the tweet
 * over waits for its Claudes before it submits (waitForClaudeTweets), then
 * rates the note and submits it like every other queued note, under the same
 * daily limit and the same rater bar. A note Claude saves after that run ends
 * goes out with the next run.
 *
 * The row moves through these stages while it stays `in_progress`:
 *   claude_waiting   the X run built the input
 *   claude_running   the runner started a Claude on it
 * and ends as a queued candidate, as rejected with no_correction_needed, or as
 * failed. While the X share of the Claude plan is used up, or the runner
 * is down, a tweet that draws Claude fails at once with the
 * reason claude_unavailable, like a tweet whose model provider is out of
 * credits. A row that is still open after CLAUDE_TWEET_MAX_WAIT_MINUTES is
 * swept as failed by the next X run.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { requestTweetInput } from "../../service/client";
import { pickVariantName } from "../ab-testing/abTests";
import { CLAUDE_X_TESTS } from "../ab-testing/abTestsData";

export const CLAUDE_CODE_BOT = "claude-code";
/** The first account's Pangram notes (GOO-880, src/x-notes/pangram.ts). A
 *  Claude judges each one, so its rows wait for the runner like a Claude
 *  tweet's. The name dates from the Pangram pre-pass of July 2026. */
export const PANGRAM_BOT = "pangram-monitoring";
/** The bots whose rows wait at claude_waiting for a Claude on the runner. */
export const CLAUDE_BOTS = [CLAUDE_CODE_BOT, PANGRAM_BOT] as const;
/** The bot A/B variant of the pipeline itself. */
export const PIPELINE_BOT = "simple-bot";
export const CLAUDE_WAITING_STAGE = "claude_waiting";
export const CLAUDE_RUNNING_STAGE = "claude_running";

/** A queued note expires 12 hours after its row was created (QUEUE_MAX_AGE_HOURS
 *  in noteQueue.ts), and a note is worth less the older its tweet gets. Three
 *  hours leaves Claude ample time while the box is busy. */
export const CLAUDE_TWEET_MAX_WAIT_MINUTES = 3 * 60;

export async function handTweetToClaude(params: {
  logger: SupabaseLogger;
  runId: string;
  post: Post;
  picks: Record<string, string>;
  logs: Record<string, unknown>;
  /** Set when the X share is used up or the runner is down. The tweet
   *  then fails, as it would when a model provider is out of credits. */
  claudeUnavailable: string | null;
}): Promise<void> {
  const { logger, runId, post, logs, claudeUnavailable } = params;
  // The runner builds the Claude's prompt from these picks.
  const picks = { ...params.picks, ...Object.fromEntries(CLAUDE_X_TESTS.map((test) => [test.name, pickVariantName(test, params.picks[test.name])])) };
  const fail = (reason: string, message: string) => {
    console.warn(`[claude] ${post.id} failed: ${message}`);
    return logger.completePipelineRun(runId, {
      outcome: "failed",
      outcome_reason: reason,
      error_message: message.slice(0, 2000),
      final_stage: "error",
      bot_name: CLAUDE_CODE_BOT,
      ab_test_picks: picks,
      logs,
    });
  };
  if (claudeUnavailable) return fail("claude_unavailable", claudeUnavailable);
  try {
    const { input } = await requestTweetInput({ priority: "x", post });
    await logger.markRunWaitingForClaude(runId, { bot: CLAUDE_CODE_BOT, picks, logs: { ...logs, claude: { input } } });
    console.log(`[claude] ${post.id} waits for a Claude`);
  } catch (err) {
    await fail("claude_input_failed", `Could not build the input for Claude: ${(err as Error).message ?? String(err)}`);
  }
}

/** How often the X run asks whether its Claudes have answered. */
const CLAUDE_POLL_MS = 15_000;

/** Waits until every tweet this run handed to Claude has an answer, or until
 *  the deadline. A Claude answers in about a minute, so the notes go out in
 *  the run that found their tweets instead of waiting half an hour for the
 *  next one (GOO-839). */
export async function waitForClaudeTweets(logger: SupabaseLogger, since: Date, deadlineMs: number): Promise<void> {
  const startedAt = Date.now();
  let open = await logger.countOpenClaudeTweets(since);
  if (open === 0) return;
  console.log(`[claude] waiting for ${open} Claude tweet(s) before submitting`);
  while (open > 0 && Date.now() + CLAUDE_POLL_MS < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, CLAUDE_POLL_MS));
    open = await logger.countOpenClaudeTweets(since);
  }
  const waited = Math.round((Date.now() - startedAt) / 1000);
  console.log(open === 0 ? `[claude] every Claude tweet answered after ${waited}s` : `[claude] ${open} Claude tweet(s) still open at the deadline after ${waited}s; the next run submits their notes`);
}
