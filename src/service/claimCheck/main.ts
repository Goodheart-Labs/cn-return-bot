/**
 * The claim-check service. It answers two questions and holds no database
 * credentials for either: whether one claim, dressed as a post, needs a note;
 * and what the X pipeline makes of one tweet, under the X pipeline's own
 * configuration. A third route only builds a tweet's input for the Claude Code
 * note writer on the ai-box. Everything the caller must record afterwards travels back in
 * the response, so the ledger stays with whoever owns the data.
 *
 * All routes share the one queue, so a reader's claims, the X note writer's
 * tweets and the feed backlog compete for the same slots in priority order.
 *
 *   bun run src/service/claimCheck/main.ts
 */

import "dotenv/config";
import { runClaimCheck } from "../../everything/pipeline/checkClaims";
import { runTweetCheck } from "../../pipeline/orchestration/runTweetCheck";
import { buildClaudeTweetInput } from "../../pipeline/input/claudeTweetInput";
import {
  CHECK_CLAIM_PATH,
  CHECK_TWEET_PATH,
  FETCH_SERVICE_SOCKET_VARIABLE,
  TWEET_INPUT_PATH,
  type CheckClaimRequest,
  type CheckClaimResponse,
  type CheckTweetRequest,
  type CheckTweetResponse,
  type TweetInputRequest,
  type TweetInputResponse,
} from "../contract";
import { numberFromEnv, requiredEnv, startService, type ServiceRoute } from "../serve";

/** Six at a time. A check takes about a minute and a half, nearly all of it
 *  waiting on searches and model calls, so running several costs little and the
 *  queue drains that much faster. */
const DEFAULT_CONCURRENCY = 6;

/** Two of the six are held for reader work, so someone waiting on a page they
 *  asked for never queues behind a long video. */
const DEFAULT_RESERVED_FOR_READER = 2;

const DEFAULT_PORT = 8787;

const checkClaimRoute: ServiceRoute<CheckClaimRequest, CheckClaimResponse> = {
  path: CHECK_CLAIM_PATH,
  priorityOf: (body) => body.priority,
  handle: async (body) => {
    if (!body?.post?.text) throw new Error("A check needs a post with text");
    const { check, run } = await runClaimCheck(body.post);
    console.log(`[claim-check] ${body.priority} post ${body.post.id}: ${check.kind} (${run.outcome})`);
    return { check, run };
  },
};

const checkTweetRoute: ServiceRoute<CheckTweetRequest, CheckTweetResponse> = {
  path: CHECK_TWEET_PATH,
  priorityOf: (body) => body.priority,
  handle: async (body) => {
    if (!body?.post?.id) throw new Error("A tweet check needs a post with an id");
    const output = await runTweetCheck(body.post, body.picks ?? {}, body.monitoring);
    console.log(`[claim-check] ${body.priority} tweet ${body.post.id}: ${output.outcome} (${output.finalStage})`);
    return { output };
  },
};

const tweetInputRoute: ServiceRoute<TweetInputRequest, TweetInputResponse> = {
  path: TWEET_INPUT_PATH,
  priorityOf: (body) => body.priority,
  handle: async (body) => {
    if (!body?.post?.id) throw new Error("A tweet input needs a post with an id");
    const input = await buildClaudeTweetInput(body.post, { describeImages: false, authorHistory: true });
    console.log(`[claim-check] ${body.priority} tweet ${body.post.id}: input for Claude built`);
    return { input };
  },
};

// On the services machine, outside pages and images are fetched only by the
// sandboxed fetcher. A service started without its socket would fetch them in
// this process, next to our keys, so it refuses to start instead.
requiredEnv(FETCH_SERVICE_SOCKET_VARIABLE);

startService({
  name: "claim-check",
  port: numberFromEnv("CLAIM_CHECK_PORT", DEFAULT_PORT),
  concurrency: numberFromEnv("CLAIM_CHECK_CONCURRENCY", DEFAULT_CONCURRENCY),
  reservedForReader: numberFromEnv("CLAIM_CHECK_RESERVED_FOR_READER", DEFAULT_RESERVED_FOR_READER),
  routes: [checkClaimRoute, checkTweetRoute, tweetInputRoute],
});
