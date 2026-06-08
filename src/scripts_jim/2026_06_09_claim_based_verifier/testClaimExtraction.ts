/**
 * Test the first claim-based-verifier call (claim extraction) on a real tweet,
 * using the note that was written in its latest prod pipeline run.
 *
 * Run:
 *   bun run src/scripts_jim/2026_06_09_claim_based_verifier/testClaimExtraction.ts <tweet-id>
 */

import "dotenv/config";
import * as path from "path";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
captureProdSupabaseCreds();

import { seedReplayFromDb } from "../../local/seedReplayFromDb";
import { extractClaims } from "../../pipeline/verify/sourceVerifier";
import { DEFAULT_CONFIG, withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withTweetLog } from "../../pipeline/utils/tweetLog";

const DEEPSEEK = "deepseek/deepseek-v4-flash";

async function main() {
  const tweetId = process.argv[2];
  if (!tweetId) throw new Error("usage: testClaimExtraction.ts <tweet-id>");

  process.env.BIG_EVAL_INPUT_CACHE ||= path.join("output", "claim-verifier-input-cache");
  process.env.CHEAP_BOT_WRITER_CACHE ||= path.join("output", "claim-verifier-writer-cache");

  const seed = await seedReplayFromDb(tweetId, "note");
  console.log(`seeded ${tweetId} from run ${seed.runId} (${seed.botName}, ${seed.outcome})`);
  console.log(`\nnote:\n${seed.noteText}`);
  console.log(`\nsources: ${JSON.stringify(seed.sources)}`);

  const claims = await withBotConfig(
    { ...DEFAULT_CONFIG, botId: "simple-bot", model: DEEPSEEK, verifier_model: DEEPSEEK, temperature: 0 },
    () => withCostTracker(() => withTweetLog(new Map(), () => extractClaims(seed.noteText!, "test"))),
  );

  console.log(`\n========== extracted ${claims.length} claim(s) ==========`);
  claims.forEach((c, i) => console.log(`${i + 1}. ${c}`));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
