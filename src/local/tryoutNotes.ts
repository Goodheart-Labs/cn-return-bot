/**
 * Tryout Notes
 *
 * Run the production pipeline on X/Twitter tweets without submitting.
 * Uses Nathan's X API credentials to fetch tweets identically to production.
 *
 * Usage:
 *   bun run src/scripts/tryoutNotes.ts <tweet-url-or-id> [<tweet-url-or-id> ...]
 *   bun run src/scripts/tryoutNotes.ts input.csv
 *   bun run src/scripts/tryoutNotes.ts --bot <bot-id> <tweet-url-or-id>
 */

import "dotenv/config";

// Remap Nathan's X API credentials → standard X API env vars
// (must happen before any X API imports read them)
for (const [src, dest] of Object.entries({
  X_NATHANPMYOUNG_API_KEY: "X_API_KEY",
  X_NATHANPMYOUNG_API_KEY_SECRET: "X_API_KEY_SECRET",
  X_NATHANPMYOUNG_ACCESS_TOKEN: "X_ACCESS_TOKEN",
  X_NATHANPMYOUNG_ACCESS_TOKEN_SECRET: "X_ACCESS_TOKEN_SECRET",
})) {
  if (process.env[src]) process.env[dest] = process.env[src];
}

// Route Supabase to local instance
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import { fetchTweetById } from "../api/fetchTweetById";
import { parseCliArgs, runPipeline, type PostFetcher } from "./localPipelineRunner";

function tweetIdToUrl(arg: string): string {
  if (/^\d+$/.test(arg)) return `https://x.com/i/status/${arg}`;
  return arg;
}

function extractTweetId(url: string): string {
  const urlMatch = url.match(/status\/(\d+)/);
  if (urlMatch) return urlMatch[1]!;
  if (/^\d+$/.test(url)) return url;
  throw new Error(`Cannot extract tweet ID from: ${url}`);
}

const fetchPost: PostFetcher = async (input) => {
  const tweetId = extractTweetId(input.url);
  const post = await fetchTweetById(tweetId);
  return { post, title: post.text.slice(0, 80) };
};

async function main() {
  const parsed = parseCliArgs("tryoutNotes", { transformArg: tweetIdToUrl });

  await runPipeline({
    scriptName: "tryoutNotes",
    folderPrefix: "tryout",
    inputs: parsed.inputs,
    fetchPost,
    forcedBotId: parsed.forcedBotId,
    datasetName: parsed.datasetName,
    reversed: parsed.reversed,
    concurrency: parsed.concurrency,
  });
}

main().catch((err) => {
  console.error("[tryoutNotes] Fatal error:", err);
  process.exit(1);
});
