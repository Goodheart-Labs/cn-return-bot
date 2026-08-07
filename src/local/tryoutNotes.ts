/**
 * Tryout Notes
 *
 * Run the production pipeline on X/Twitter tweets without submitting anything.
 * Tweets are fetched exactly as production fetches them, using one person's X
 * API credentials from the environment.
 *
 * Usage:
 *   bun run src/local/tryoutNotes.ts [flags] <input.csv | tweet-url-or-id...>
 *
 * Flags:
 *   --bot <id>              force a specific bot (shorthand for --pick bot=<id>)
 *   --topic <id>            run as a curated-topic post. This injects the
 *                           topic's grounding document and its advisory eval
 *                           gate, exactly as stage 3 of the production misinfo
 *                           pre-pass does.
 *   --pick test=variant     force an A/B test variant (repeatable)
 *   --max <n>               limit number of inputs
 *   --reversed              process newest-last
 *   --concurrency <n>       parallel workers (default 5)
 *   --name <label>          name for dashboard upload (default: derived)
 *   --from-db [level]       replay each tweet's most recent production run,
 *                           reusing data from that run's logs. Each level also
 *                           reuses what the previous one reuses. The default
 *                           level is `tweet`.
 *                             tweet  reuse the post, so there is no X fetch.
 *                                    Everything else is rebuilt.
 *                             input  also reuse the full input, which covers
 *                                    the comments, the media and the author.
 *                             note   also reuse the written note, so only the
 *                                    gates run again.
 *                           This defaults to --bot simple-bot. Override it with
 *                           --bot.
 */

import "dotenv/config";
import { captureProdSupabaseCreds } from "./prodSupabaseCreds";
captureProdSupabaseCreds();

// Copy one person's X API credentials onto the standard X API environment
// variables. This has to happen before anything that reads those variables is
// imported. The first prefix that has all four values set wins. Jim's keys come
// first, so a user with a fresh account does not quietly spend Nathan's quota.
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

// Send every Supabase write from this run to the local instance.
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

// --from-db fills this map from the production logs. The replay then reuses the
// exact post the original run saw and never calls the X API.
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

/** Seed the replay caches from the production logs, up to the given level. Each
 *  level reuses more of the logged run. First the post, then the input, then the
 *  note. The cache reads that already exist in the pipeline skip the matching
 *  stages. Both simple-bot and cheap-bot can read the writer cache, so either of
 *  them may be forced with --bot. When no bot is forced we use simple-bot,
 *  because that is the bot production runs. */
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

  // The level word after --from-db is optional. Without one we replay at the
  // `tweet` level.
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
