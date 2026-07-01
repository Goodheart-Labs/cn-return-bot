/**
 * Fetch genuine post context for the 3 newly-added writer few-shot examples
 * (GTA pre-orders, Infantino two-matches, Simpsons 3D printer). The descriptions
 * currently in prompts/simple-bot/writer.ts were hand-written from dashboard
 * screenshots; this pulls the real tweet text + quoted post + Gemini media
 * analysis so we can replace them.
 *
 * Step 1: look up each post's tweet_id in `notes` by a distinctive substring of
 *         OUR note text (the note we wrote, stored in the DB).
 * Step 2: fetchTweetById → analyzeMediaGemini (same path as 04_fetch_examples).
 *
 * Run: bun run src/scripts_jim/2026_07_01_writer_examples_media/fetch.ts
 */

import { fetchTweetById } from "../../api/fetchTweetById";
import { analyzeMediaGemini } from "../../pipeline/media/mediaAnalysisGemini";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";
import { getSupabaseClient } from "../../api/supabaseClient";

// Remap a personal X credential set → standard X_* env vars (prod notewriter
// keys are write-only and 403 on tweet lookup). Mirrors 04_fetch_examples.
const X_KEY_PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
for (const prefix of X_KEY_PREFIXES) {
  if (!X_KEY_SUFFIXES.every((s) => process.env[`${prefix}_${s}`])) continue;
  for (const suffix of X_KEY_SUFFIXES) process.env[`X_${suffix}`] = process.env[`${prefix}_${suffix}`];
  console.log(`[fetch] Using X API credentials: ${prefix}`);
  break;
}

// Distinctive substring of OUR note text → find the tweet we wrote it on.
const OUR_NOTE_SUBSTRINGS: Record<string, string> = {
  gta_preorders: "has not surpassed 50 million pre-orders",
  infantino_matches: "do not show Gianni Infantino at two simultaneous matches",
  simpsons_3dprint: "did not predict the 3D printer",
};

async function lookupTweetId(substring: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from("notes")
    .select("tweet_id, note_text, submitted_at")
    .ilike("note_text", `%${substring}%`)
    .order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.tweet_id as string))];
}

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

async function dumpTweet(tweetId: string) {
  let post;
  try {
    post = await fetchTweetById(tweetId);
  } catch (err: any) {
    console.log(`  FETCH FAILED: ${err.message}`);
    return;
  }
  console.log(`  author: ${post.author_name} (@${post.author_username ?? "?"})`);
  console.log(`  text: ${JSON.stringify(post.text)}`);
  if (post.referenced_tweet_data?.text) {
    console.log(`  quoted post text: ${JSON.stringify(post.referenced_tweet_data.text)}`);
  }
  const hasMedia = (post.media?.length ?? 0) > 0 || (post.referenced_tweet_data?.media?.length ?? 0) > 0;
  if (!hasMedia) {
    console.log("  (no media)");
    return;
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

async function main() {
  for (const [name, substring] of Object.entries(OUR_NOTE_SUBSTRINGS)) {
    console.log("\n" + "=".repeat(100));
    console.log(`${name}  (our-note match: "${substring}")`);
    const tweetIds = await lookupTweetId(substring);
    if (tweetIds.length === 0) {
      console.log("  NO tweet_id found in notes");
      continue;
    }
    if (tweetIds.length > 1) console.log(`  ${tweetIds.length} candidate tweet_ids: ${tweetIds.join(", ")}`);
    for (const tweetId of tweetIds) {
      console.log(`  --- tweet_id ${tweetId} ---`);
      await dumpTweet(tweetId);
    }
  }
}

main().then(() => process.exit(0));
