/**
 * Test the image-aware source verifier on a real tweet by replaying its latest
 * prod run (post + input + written note from logs) and running verifySources
 * twice: once WITHOUT images (text-only baseline) and once WITH images.
 *
 * Run:
 *   bun run src/scripts_jim/2026_06_06_verifier_sees_images/testVerifierImages.ts <tweet-id>
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
import { withTweetLog, type TweetLogMap } from "../../pipeline/utils/tweetLog";

const GEMINI = "google/gemini-3-flash-preview";

function baseConfig(seesImages: boolean): BotConfig {
  return {
    ...DEFAULT_CONFIG,
    botId: "simple-bot",
    model: GEMINI,
    verifier_model: GEMINI,
    verifier_accepts_media_sources: true,
    verifier_sees_images: seesImages,
    temperature: 0,
  };
}

async function runVariant(
  seesImages: boolean,
  input: ReturnType<typeof readInputCache>,
  postContext: string,
  noteText: string,
  sources: string[],
): Promise<void> {
  const log: TweetLogMap = new Map();
  const result = await withBotConfig(baseConfig(seesImages), () =>
    withCostTracker(() =>
      withTweetLog(log, () =>
        verifySources({
          noteText,
          sources,
          postContext,
          mediaResult: input!.mediaResult,
          turnNumber: 1,
        }),
      ),
    ),
  );

  const label = seesImages ? "WITH images" : "text-only";
  console.log(`\n========== ${label} ==========`);
  const msg0 = log.get("note_writer_steps.source_verifier.turn.1.messages.0") as any;
  if (msg0?.images) {
    console.log(`attached images (${msg0.images.length}):`);
    for (const img of msg0.images) console.log(`  Image ${img.index}: ${img.origin} — ${img.url}`);
  } else {
    console.log("attached images: none");
  }
  console.log(`accepted: ${result.accepted}`);
  console.log(`good_sources: ${JSON.stringify(result.good_sources)}`);
  console.log(`bad_sources:  ${JSON.stringify(result.bad_sources)}`);
  console.log(`reasoning: ${result.reasoning}`);
}

async function main() {
  const tweetId = process.argv[2];
  if (!tweetId) throw new Error("usage: testVerifierImages.ts <tweet-id>");

  process.env.BIG_EVAL_INPUT_CACHE ||= path.join("output", "verifier-images-input-cache");
  process.env.CHEAP_BOT_WRITER_CACHE ||= path.join("output", "verifier-images-writer-cache");

  const seed = await seedReplayFromDb(tweetId, "note");
  console.log(`seeded ${tweetId} from run ${seed.runId} (${seed.botName}, ${seed.outcome})`);
  console.log(`note: ${seed.noteText}`);
  console.log(`sources: ${JSON.stringify(seed.sources)}`);

  const input = readInputCache(tweetId, seed.inputStrategy ?? "frames");
  if (!input) throw new Error("input cache miss after seeding");
  console.log(
    `post media: ${input.mediaResult.tweetMedia.length} tweet, ${input.mediaResult.quotedTweetMedia.length} quoted` +
      ` (images: ${[...input.mediaResult.tweetMedia, ...input.mediaResult.quotedTweetMedia].filter((m) => m.type === "image").length})`,
  );

  const postContext = buildUserMessageFromInput(seed.post, input);
  const noteText = seed.noteText!;
  const sources = seed.sources ?? [];

  await runVariant(false, input, postContext, noteText, sources);
  await runVariant(true, input, postContext, noteText, sources);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
