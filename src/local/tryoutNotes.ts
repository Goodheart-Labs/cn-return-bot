/**
 * Tryout Notes
 *
 * Run the production pipeline on X/Twitter tweets without submitting.
 * Uses Nathan's X API credentials to fetch tweets identically to production.
 *
 * Usage:
 *   bun run src/local/tryoutNotes.ts [flags] <input.csv | tweet-url-or-id...>
 *
 * Flags:
 *   --bot <id>              force a specific bot (shorthand for --pick bot=<id>)
 *   --pick test=variant     force an A/B test variant (repeatable)
 *   --max <n>               limit number of inputs
 *   --reversed              process newest-last
 *   --concurrency <n>       parallel workers (default 5)
 *   --name <label>          name for dashboard upload (default: derived)
 */

import "dotenv/config";
import { captureProdSupabaseCreds } from "./prodSupabaseCreds";
captureProdSupabaseCreds();

// Remap a per-user X API credential set → standard X API env vars
// (must happen before any X API imports read them). First prefix that's fully
// populated wins; Jim's keys take priority so a fresh-account user doesn't
// silently fall back to Nathan's quota.
const X_KEY_PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
for (const prefix of X_KEY_PREFIXES) {
  const allSet = X_KEY_SUFFIXES.every((s) => process.env[`${prefix}_${s}`]);
  if (!allSet) continue;
  for (const suffix of X_KEY_SUFFIXES) {
    process.env[`X_${suffix}`] = process.env[`${prefix}_${suffix}`];
  }
  console.log(`[tryoutNotes] Using X API credentials: ${prefix}`);
  break;
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
  const args = process.argv.slice(2);
  const finalFlag = args.includes("--final");
  if (finalFlag) args.splice(args.indexOf("--final"), 1);
  process.argv = ["bun", "tryoutNotes.ts", ...args];

  const touchesSealedSet = args.some(
    (a) => a.includes("datasets/big_eval/splits/test.csv") || a.endsWith("/test.csv"),
  );
  if (touchesSealedSet && !finalFlag) {
    console.error(
      "[tryoutNotes] datasets/big_eval/splits/test.csv is the sealed held-out set.\n" +
      "             Pass --final to run on it (only do this at end-of-iteration handoff).",
    );
    process.exit(1);
  }

  const parsed = parseCliArgs("tryoutNotes", { transformArg: tweetIdToUrl });

  await runPipeline({
    scriptName: "tryoutNotes",
    folderPrefix: "tryout",
    inputs: parsed.inputs,
    fetchPost,
    forcedPicks: parsed.forcedPicks,
    datasetName: parsed.datasetName,
    reversed: parsed.reversed,
    concurrency: parsed.concurrency,
    runName: parsed.runName,
  });
}

main().catch((err) => {
  console.error("[tryoutNotes] Fatal error:", err);
  process.exit(1);
});
