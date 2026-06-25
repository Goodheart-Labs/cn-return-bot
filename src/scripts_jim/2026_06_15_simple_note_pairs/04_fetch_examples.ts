/**
 * Fetch the real tweet text + media descriptions + quoted post for the 5
 * few-shot writer examples, so the prompt block uses genuine post context
 * instead of reconstructed-from-note descriptions.
 *
 * For each tweet: fetchTweetById (prod read keys) → analyzeMediaGemini (same
 * Gemini media analysis the pipeline runs) → print text/quoted/media so we can
 * paste real context into prompts/simple-bot/writer.ts.
 *
 * Run: bun run src/scripts_jim/2026_06_15_simple_note_pairs/04_fetch_examples.ts
 */

import { fetchTweetById } from "../../api/fetchTweetById";
import { analyzeMediaGemini } from "../../pipeline/media/mediaAnalysisGemini";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";

// Remap a personal X credential set → standard X_* env vars (the prod
// notewriter keys are write-only and 403 on tweet lookup). Mirrors tryoutNotes.
const X_KEY_PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
for (const prefix of X_KEY_PREFIXES) {
  if (!X_KEY_SUFFIXES.every((s) => process.env[`${prefix}_${s}`])) continue;
  for (const suffix of X_KEY_SUFFIXES) process.env[`X_${suffix}`] = process.env[`${prefix}_${suffix}`];
  console.log(`[fetch_examples] Using X API credentials: ${prefix}`);
  break;
}

const EXAMPLES: Record<string, string> = {
  ai_video: "2000630515133559049",
  wolf_rescue: "2064530866748166403",
  trump_eastwing: "1981137216408862743",
  walmart_snap: "1982883983626252690",
  nintendo_palworld: "1983589561017217434",
};

function fmtMedia(items: { type: string; description: { description?: string; ocrText?: string }; transcription?: string }[]): string {
  return items
    .map((m, i) => {
      const lines = [`  [${m.type} ${i + 1}]`];
      if (m.description.description) lines.push(`    description: ${m.description.description}`);
      if (m.description.ocrText) lines.push(`    visible text: ${m.description.ocrText}`);
      if (m.transcription) lines.push(`    transcript: ${m.transcription}`);
      return lines.join("\n");
    })
    .join("\n");
}

async function main() {
  for (const [name, tweetId] of Object.entries(EXAMPLES)) {
    console.log("\n" + "=".repeat(100));
    console.log(`${name}  (${tweetId})`);
    let post;
    try {
      post = await fetchTweetById(tweetId);
    } catch (err: any) {
      console.log(`  FETCH FAILED: ${err.message}`);
      continue;
    }
    console.log(`  author: ${post.author_name} (@${post.author_username ?? "?"})`);
    console.log(`  text: ${JSON.stringify(post.text)}`);
    if (post.referenced_tweet_data?.text) {
      console.log(`  quoted post text: ${JSON.stringify(post.referenced_tweet_data.text)}`);
    }
    const hasMedia = (post.media?.length ?? 0) > 0 || (post.referenced_tweet_data?.media?.length ?? 0) > 0;
    if (!hasMedia) {
      console.log("  (no media)");
      continue;
    }
    try {
      const media = await withBotConfig({ ...DEFAULT_CONFIG, botId: "fetch-examples" }, () =>
        analyzeMediaGemini(post!.media, post!.referenced_tweet_data?.media, "frames", post!.entities),
      );
      if (media.tweetMedia.length) console.log("  media on post:\n" + fmtMedia(media.tweetMedia as any));
      if (media.quotedTweetMedia.length) console.log("  media on quoted post:\n" + fmtMedia(media.quotedTweetMedia as any));
    } catch (err: any) {
      console.log(`  MEDIA ANALYSIS FAILED: ${err.message}`);
    }
  }
}

main().then(() => process.exit(0));
