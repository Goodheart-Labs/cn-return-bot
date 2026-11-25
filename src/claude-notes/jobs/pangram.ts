/* A post the first account's Pangram pass handed to the judge (GOO-880, see
 * src/x-notes/pangram.ts). Pangram called the post AI-written. The runner
 * starts one isolated Claude without any tools. It reads the post and the
 * July 2026 Pangram notes, and answers whether the post should get a note
 * saying that it is AI-written. On a yes, the first account's writer submits
 * the note.
 *
 * The judge opens no image or link, so the image screen is not needed. */

import { PANGRAM_BOT } from "../../pipeline/orchestration/claudeTweets";
import { PANGRAM_EXAMPLES_PATH, PANGRAM_VERDICT_SCHEMA, pangramPrompt } from "../prompts";
import { resultEvent } from "../runner/session";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { X_SHARES } from "../xShare";
import { failXTweet, markXTweetRunning, openXTweets, type PangramVerdict, savePangramVerdict, xTweetIsOpen, type XTweet } from "../xTweets";
import { type JobKind, mayRetry, STOP_BEFORE_DEADLINE_MS } from "./kind";
import { sweptAt } from "./tweet";

/** At most 3 Pangram notes a day come, so 2 at once is plenty. */
const MAX_JUDGES_RUNNING = 2;

export const pangramJob: JobKind<XTweet> = {
  name: "pangram",
  sessionPrefix: "cn-pg-",
  maxRunning: MAX_JUDGES_RUNNING,
  tags: (tweet) => [X_SHARES[tweet.xAccount].tag, CLAUDE_RUN_TAGS.pangram],
  key: (tweet) => tweet.runId,

  async waiting() {
    return (await openXTweets(PANGRAM_BOT)).waiting.filter((tweet) => sweptAt(tweet) - STOP_BEFORE_DEADLINE_MS > Date.now());
  },

  async held() {
    return (await openXTweets(PANGRAM_BOT)).running;
  },

  async prepare(tweet, _runDir, attempt) {
    await markXTweetRunning(tweet.runId, attempt);
    return {
      prompt: pangramPrompt(tweet),
      command: { model: "opus", effort: "high", appendSystemPromptFile: PANGRAM_EXAMPLES_PATH, isolated: { jsonSchema: PANGRAM_VERDICT_SCHEMA, tools: { kind: "none" } } },
    };
  },

  stopAt: (tweet) => sweptAt(tweet) - STOP_BEFORE_DEADLINE_MS,
  ref: (tweet) => ({ pipeline_run_id: tweet.runId }),

  /** Saves the judge's answer. A judge without one gets one more try. */
  async close(tweet, run) {
    if (!(await xTweetIsOpen(tweet.runId))) return "closed";
    const verdict = resultEvent(run.runDir)?.structured_output as PangramVerdict | undefined;
    if (verdict) {
      await savePangramVerdict(tweet.runId, verdict);
      console.log(`The Pangram judge on tweet ${tweet.tweetId} said ${verdict.should_get_this_is_ai_written_community_note ? "yes" : "no"}`);
      return "closed";
    }
    if (mayRetry(run)) return "retry";
    await failXTweet(tweet.runId, run.timedOut ? `The Pangram judge was stopped before the sweep without an answer; see ${run.runDir}` : `The Pangram judge ended twice without an answer; see ${run.runDir}`);
    return "closed";
  },
};
