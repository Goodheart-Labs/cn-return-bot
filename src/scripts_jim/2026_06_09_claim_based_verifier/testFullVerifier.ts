/**
 * Run the full source verifier on a real tweet's latest prod note, both flows:
 * classic (single accept/reject call) and claim-based (extract claims → map each
 * to supporting sources). Compares accepted / good_sources / reasoning.
 *
 * Run:
 *   bun run src/scripts_jim/2026_06_09_claim_based_verifier/testFullVerifier.ts <tweet-id>
 */

import "dotenv/config";
import * as path from "path";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
captureProdSupabaseCreds();

import { seedReplayFromDb } from "../../local/seedReplayFromDb";
import { readInputCache } from "../../pipeline/input/inputCache";
import { buildUserMessageFromInput } from "../../pipeline/input/prompt";
import { verifySources } from "../../pipeline/verify/sourceVerifier";
import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withTweetLog } from "../../pipeline/utils/tweetLog";

const DEEPSEEK = "deepseek/deepseek-v4-flash";

function config(claimBased: boolean): BotConfig {
  return {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    model: DEEPSEEK,
    verifier_model: DEEPSEEK,
    verifier_accepts_media_sources: true,
    verifier_claim_based: claimBased,
    temperature: 0,
  };
}

async function runVariant(claimBased: boolean, postContext: string, noteText: string, sources: string[]) {
  const log = new Map();
  const result = await withBotConfig(config(claimBased), () =>
    withCostTracker(() =>
      withTweetLog(log, () => verifySources({ noteText, sources, postContext, turnNumber: 1 })),
    ),
  );
  console.log(`\n========== ${claimBased ? "claim-based" : "classic"} ==========`);
  if (claimBased) console.log(`claims: ${JSON.stringify(log.get("note_writer_steps.source_verifier.turn.1.claims"))}`);
  console.log(`accepted:     ${result.accepted}`);
  console.log(`good_sources: ${JSON.stringify(result.good_sources)}`);
  console.log(`bad_sources:  ${JSON.stringify(result.bad_sources)}`);
  console.log(`reasoning:    ${result.reasoning}`);
}

async function main() {
  const tweetId = process.argv[2];
  if (!tweetId) throw new Error("usage: testFullVerifier.ts <tweet-id>");

  process.env.BIG_EVAL_INPUT_CACHE ||= path.join("output", "claim-verifier-input-cache");
  process.env.WRITER_CACHE ||= path.join("output", "claim-verifier-writer-cache");

  const seed = await seedReplayFromDb(tweetId, "note");
  const input = readInputCache(tweetId, seed.inputStrategy ?? "frames");
  if (!input) throw new Error("input cache miss after seeding");
  const postContext = buildUserMessageFromInput(seed.post, input);

  console.log(`seeded ${tweetId} (${seed.botName}, ${seed.outcome})`);
  console.log(`note: ${seed.noteText}`);
  console.log(`sources: ${JSON.stringify(seed.sources)}`);

  await runVariant(false, postContext, seed.noteText!, seed.sources ?? []);
  await runVariant(true, postContext, seed.noteText!, seed.sources ?? []);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
