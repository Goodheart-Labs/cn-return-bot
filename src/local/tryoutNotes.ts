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
 *   --topic <id>            run as a curated-topic post: inject the topic's
 *                           grounding document + advisory eval gate, exactly
 *                           as the prod misinfo pre-pass stage 3 does
 *   --pick test=variant     force an A/B test variant (repeatable)
 *   --max <n>               limit number of inputs
 *   --reversed              process newest-last
 *   --concurrency <n>       parallel workers (default 5)
 *   --name <label>          name for dashboard upload (default: derived)
 *   --from-db [level]       replay each tweet's most recent prod run, reusing
 *                           data from its prod logs. Levels (each includes the
 *                           previous), default `tweet`:
 *                             tweet  reuse the post (no X fetch); rebuild everything else
 *                             input  also reuse the full input (comments, media, author)
 *                             note   also reuse the written note → only the gates re-run
 *                           Defaults to --bot simple-bot (override with --bot).
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

import * as path from "path";
import { fetchTweetById } from "../api/fetchTweetById";
import type { Post } from "../api/fetchEligiblePosts";
import { parseCliArgs, runPipeline, type InputRow, type PostFetcher } from "./localPipelineRunner";
import { seedReplayFromDb, REPLAY_LEVELS, type ReplayLevel } from "./seedReplayFromDb";

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

// --from-db seeds these from prod logs so the replay reuses the exact post the
// original run saw — no X API round-trip.
const seededPosts = new Map<string, Post>();

const fetchPost: PostFetcher = async (input) => {
  const tweetId = extractTweetId(input.url);
  const seeded = seededPosts.get(tweetId);
  const post = seeded ?? (await fetchTweetById(tweetId));
  return { post, title: post.text.slice(0, 80) };
};

const DEFAULT_INPUT_CACHE_DIR = path.join("output", "from-db-input-cache");
const DEFAULT_WRITER_CACHE_DIR = path.join("output", "from-db-writer-cache");

function rankLevel(level: ReplayLevel): number {
  return REPLAY_LEVELS.indexOf(level);
}

/** Seed the replay caches from prod logs up to `level`, defaulting to simple-bot.
 *  Each level reuses more from the logged run (post → input → note); the
 *  existing cache-read paths short-circuit the corresponding pipeline stages.
 *  Both simple-bot and cheap-bot support the writer cache, so either may be
 *  forced via --bot; with none given we default to simple-bot (production). */
async function seedFromDb(
  inputs: InputRow[],
  forcedPicks: Record<string, string>,
  level: ReplayLevel,
): Promise<void> {
  if (!forcedPicks.bot) forcedPicks.bot = "simple-bot";

  if (rankLevel(level) >= rankLevel("input") && !process.env.BIG_EVAL_INPUT_CACHE) {
    process.env.BIG_EVAL_INPUT_CACHE = DEFAULT_INPUT_CACHE_DIR;
    console.log(`[tryoutNotes] --from-db ${level}: input cache → ${DEFAULT_INPUT_CACHE_DIR}`);
  }
  if (rankLevel(level) >= rankLevel("note") && !process.env.WRITER_CACHE) {
    process.env.WRITER_CACHE = DEFAULT_WRITER_CACHE_DIR;
    console.log(`[tryoutNotes] --from-db ${level}: writer cache → ${DEFAULT_WRITER_CACHE_DIR}`);
  }

  for (const input of inputs) {
    const tweetId = extractTweetId(input.url);
    const seed = await seedReplayFromDb(tweetId, level);
    seededPosts.set(tweetId, seed.post);
    const noteInfo = seed.noteText
      ? ` — ${seed.sources?.length ?? 0} source(s)${seed.fromRevisedNote ? " [post-revision note]" : ""}`
      : "";
    console.log(
      `[tryoutNotes] seeded ${tweetId} @${level} from run ${seed.runId} (${seed.botName}, ${seed.outcome})${noteInfo}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const finalFlag = args.includes("--final");
  if (finalFlag) args.splice(args.indexOf("--final"), 1);

  // --from-db [tweet|input|note]; the level word is optional (default `tweet`).
  let fromDbLevel: ReplayLevel | null = null;
  const fromDbIdx = args.indexOf("--from-db");
  if (fromDbIdx !== -1) {
    const next = args[fromDbIdx + 1];
    if (next && (REPLAY_LEVELS as readonly string[]).includes(next)) {
      fromDbLevel = next as ReplayLevel;
      args.splice(fromDbIdx, 2);
    } else {
      fromDbLevel = "tweet";
      args.splice(fromDbIdx, 1);
    }
  }
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

  if (fromDbLevel) await seedFromDb(parsed.inputs, parsed.forcedPicks, fromDbLevel);

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
    topicId: parsed.topicId,
  });
}

main().catch((err) => {
  console.error("[tryoutNotes] Fatal error:", err);
  process.exit(1);
});
