/* An X tweet the X run handed to Claude (GOO-527, see
 * src/pipeline/orchestration/claudeTweets.ts). The X run leaves the tweet's
 * pipeline_runs row waiting at claude_waiting. The runner screens the tweet's
 * images for known abuse images, starts one Claude, and the Claude answers with `claude-notes x-note`
 * or `x-no-note`. The next X run rates a queued note and submits it. */

import { CLAUDE_CODE_BOT, CLAUDE_TWEET_MAX_WAIT_MINUTES } from "../../pipeline/orchestration/claudeTweets";
import { tellSlack } from "../alerts";
import { screenImages } from "../imageScreen";
import { tweetPrompt, X_EXAMPLES_PATH } from "../prompts";
import { tweetHasExamples, tweetModel } from "../tweetArms";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { failXTweet, markXTweetRunning, openXTweets, xTweetIsOpen, type XTweet } from "../xTweets";
import { type JobKind, mayRetry, STOP_BEFORE_DEADLINE_MS } from "./kind";

/** Tweets in progress at once. The X share of the week (xShare.ts) decides
 *  how many tweets come; this only stops a burst from one X run from starting
 *  all its tweets at the same moment. A tweet's Claude takes about a minute,
 *  so 6 at a time finish the dozen tweets of one X run in a few minutes. */
const MAX_TWEETS_RUNNING = 6;
/** A tweet with less time than this before the X run sweeps it is not
 *  started: its Claude would be stopped before it could answer. */
const MIN_TIME_TO_START_MS = 20 * 60_000;

/** A tweet's Claude must stop before the X run sweeps the tweet as failed. */
const sweptAt = (tweet: XTweet) => Date.parse(tweet.createdAt) + CLAUDE_TWEET_MAX_WAIT_MINUTES * 60_000;

/** Whether the tweet's images passed the image screen (GOO-815), or the host
 *  has no screen (GOO-822). A tweet they did not pass fails, and Slack hears of it. When the screen itself
 *  fails, the tweet fails too and the error goes on to the scheduler. */
async function passesScreen(tweet: XTweet): Promise<boolean> {
  let screen;
  try {
    screen = await screenImages(tweet.input, { sexualContent: false });
  } catch (err) {
    await failXTweet(tweet.runId, `The image screen could not run: ${(err as Error).message}`, "image_screen_failed");
    throw err;
  }
  if (screen.kind !== "flagged") return true;
  await failXTweet(tweet.runId, `The image screen flagged an image (${screen.reason}), so no Claude saw this tweet`, "image_flagged");
  await tellSlack(`The image screen stopped X tweet run ${tweet.runId}: ${screen.reason}. No Claude saw it.`);
  return false;
}

export const tweetJob: JobKind<XTweet> = {
  name: "tweet",
  sessionPrefix: "cn-x-",
  maxRunning: MAX_TWEETS_RUNNING,
  tags: [CLAUDE_RUN_TAGS.x, CLAUDE_RUN_TAGS.tweet],
  key: (tweet) => tweet.runId,

  /** X tweets are not part of Claude's pace, because the X run already decided
   *  that they go to Claude. */
  async waiting() {
    return (await openXTweets()).waiting.filter((tweet) => sweptAt(tweet) - STOP_BEFORE_DEADLINE_MS - Date.now() >= MIN_TIME_TO_START_MS);
  },

  async held() {
    return (await openXTweets()).running;
  },

  async prepare(tweet, runDir, attempt) {
    if (attempt === 1 && !(await passesScreen(tweet))) return null;
    await markXTweetRunning(tweet.runId, attempt);
    return {
      prompt: tweetPrompt({ tweet, runDir }),
      command: {
        ...tweetModel(tweet.picks),
        ...(tweetHasExamples(tweet.picks) && { appendSystemPromptFile: X_EXAMPLES_PATH }),
      },
    };
  },

  stopAt: (tweet) => sweptAt(tweet) - STOP_BEFORE_DEADLINE_MS,
  ref: (tweet) => ({ pipeline_run_id: tweet.runId }),

  /** A Claude that ended without a note or a no-note gets one more try. The
   *  stage guards in xTweets.ts make sure an answer is never saved twice. */
  async close(tweet, run) {
    console.log(`The Claude on tweet ${tweet.tweetId} ended after ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes`);
    if (!(await xTweetIsOpen(tweet.runId))) return "closed";
    if (mayRetry(run)) return "retry";
    await failXTweet(
      tweet.runId,
      run.timedOut ? `The ${CLAUDE_CODE_BOT} note writer was stopped before the X run's sweep without an answer; see ${run.runDir}` : `The ${CLAUDE_CODE_BOT} note writer exited twice without an answer; see ${run.runDir}`,
    );
    return "closed";
  },
};
