/**
 * The claim-check service. It takes one claim, dressed as a post, and answers
 * whether it needs a note.
 *
 * It holds no database credentials and writes nothing. The run record it
 * answers with is what the caller stores, so the ledger stays with whoever owns
 * the data.
 *
 *   bun run src/service/claimCheck/main.ts
 */

import "dotenv/config";
import { runClaimCheck } from "../../everything/pipeline/checkClaims";
import { CHECK_CLAIM_PATH, type CheckClaimRequest, type CheckClaimResponse } from "../contract";
import { numberFromEnv, startService } from "../serve";

/** Six at a time. A check takes about a minute and a half, nearly all of it
 *  waiting on searches and model calls, so running several costs little and the
 *  queue drains that much faster. */
const DEFAULT_CONCURRENCY = 6;

/** Two of the six are held for reader work, so someone waiting on a page they
 *  asked for never queues behind a long video. */
const DEFAULT_RESERVED_FOR_READER = 2;

const DEFAULT_PORT = 8787;

startService<CheckClaimRequest, CheckClaimResponse>({
  name: "claim-check",
  port: numberFromEnv("CLAIM_CHECK_PORT", DEFAULT_PORT),
  concurrency: numberFromEnv("CLAIM_CHECK_CONCURRENCY", DEFAULT_CONCURRENCY),
  reservedForReader: numberFromEnv("CLAIM_CHECK_RESERVED_FOR_READER", DEFAULT_RESERVED_FOR_READER),
  route: {
    path: CHECK_CLAIM_PATH,
    priorityOf: (body) => body.priority,
    handle: async (body) => {
      if (!body?.post?.text) throw new Error("A check needs a post with text");
      const { check, run } = await runClaimCheck(body.post);
      console.log(`[claim-check] ${body.priority} post ${body.post.id}: ${check.kind} (${run.outcome})`);
      return { check, run };
    },
  },
});
