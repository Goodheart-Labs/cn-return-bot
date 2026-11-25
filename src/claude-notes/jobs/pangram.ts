/* A post the first account's Pangram pass handed to the judge (GOO-880, see
 * src/x-notes/pangram.ts). Pangram called the post AI-written. The runner
 * screens its images, starts one Claude, and the Claude answers with
 * `claude-notes pangram-verdict`: whether the fixed Pangram note would very
 * likely be rated helpful. On a yes, the first account's writer submits the
 * note. */

import { PANGRAM_BOT } from "../../pipeline/orchestration/claudeTweets";
import { PANGRAM_EXAMPLES_PATH, pangramPrompt } from "../prompts";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { X_SHARES } from "../xShare";
import { failXTweet, markXTweetRunning, openXTweets, xTweetIsOpen, type XTweet } from "../xTweets";
import { type JobKind, mayRetry, STOP_BEFORE_DEADLINE_MS } from "./kind";
import { passesScreen, sweptAt } from "./tweet";

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

  async prepare(tweet, runDir, attempt) {
    if (attempt === 1 && !(await passesScreen(tweet))) return null;
    await markXTweetRunning(tweet.runId, attempt);
    return { prompt: pangramPrompt({ tweet, runDir }), command: { model: "opus", effort: "high", appendSystemPromptFile: PANGRAM_EXAMPLES_PATH } };
  },

  stopAt: (tweet) => sweptAt(tweet) - STOP_BEFORE_DEADLINE_MS,
  ref: (tweet) => ({ pipeline_run_id: tweet.runId }),

  async close(tweet, run) {
    if (!(await xTweetIsOpen(tweet.runId))) return "closed";
    if (mayRetry(run)) return "retry";
    await failXTweet(tweet.runId, run.timedOut ? `The Pangram judge was stopped before the sweep without an answer; see ${run.runDir}` : `The Pangram judge exited twice without an answer; see ${run.runDir}`);
    return "closed";
  },
};
