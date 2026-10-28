/**
 * Tweets for the Claude Code note writer (GOO-527).
 *
 * The bot A/B test has a variant `claude-code`. A tweet that draws it is not
 * checked by the pipeline. Instead the X run asks the claim-check service to
 * build the tweet's input (src/pipeline/input/claudeTweetInput.ts) and leaves
 * the tweet's pipeline_runs row open, at the final stage `claude_waiting`.
 * The runner on Nathan's ai-box (src/claude-notes/runner.ts) finds the row and
 * starts one Claude Opus for it. That Claude saves its note on the same row and
 * puts it in the note queue (noteQueue.ts). The next X run then rates it and
 * submits it like every other queued note, under the same daily limit and the
 * same rater bar.
 *
 * The row moves through these stages while it stays `in_progress`:
 *   claude_waiting   the X run built the input
 *   claude_running   the runner started a Claude on it
 * and ends as a queued candidate, as rejected with no_correction_needed, or as
 * failed. While the X share of Nathan's Claude plan is used up, or the runner
 * on the ai-box is down, a tweet that draws Claude fails at once with the
 * reason claude_unavailable, like a tweet whose model provider is out of
 * credits. A row that is still open after CLAUDE_TWEET_MAX_WAIT_MINUTES is
 * swept as failed by the next X run.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { requestTweetInput } from "../../service/client";

export const CLAUDE_CODE_BOT = "claude-code";
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
  /** Set when the X share is used up or the ai-box runner is down. The tweet
   *  then fails, as it would when a model provider is out of credits. */
  claudeUnavailable: string | null;
}): Promise<void> {
  const { logger, runId, post, picks, logs, claudeUnavailable } = params;
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
    await logger.markRunWaitingForClaude(runId, { picks, logs: { ...logs, claude: { input } } });
    console.log(`[claude] ${post.id} waits for a Claude on the ai-box`);
  } catch (err) {
    await fail("claude_input_failed", `Could not build the input for Claude: ${(err as Error).message ?? String(err)}`);
  }
}
