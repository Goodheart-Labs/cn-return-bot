/**
 * Offline cheap-bot judge-model A/B replay.
 *
 * The standard `tryoutNotes --writer-cache` path still calls fetchTweetById per
 * row (to get the Post), and X's read quota is currently exhausted (HTTP 402),
 * so every row errors before any LLM call. But we don't need X at all: the
 * input cache (BIG_EVAL_INPUT_CACHE) already stores the full original Post for
 * every val id. This script serves fetchPost from that cache so the entire run
 * is offline w.r.t. X — only OpenRouter (judge + verifier) is hit.
 *
 * It reuses the production runPipeline (so logs are written in the current
 * note_writer_steps.* schema the V2 categorizer reads), the writer cache (so
 * stages 1-3 are replayed, holding writer/search constant), and forces the
 * cheap_bot_judge_model A/B pick. One runPipeline call per model → one results
 * table + one dashboard each.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_29_judge_model_abtest/replayOffline.ts
 */
import "dotenv/config";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
captureProdSupabaseCreds();

// Route Supabase to local (mirror tryoutNotes). No X credential remap — we
// never touch X here.
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import * as fs from "fs";
import * as path from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import type { CachedInput } from "../../pipeline/input/inputCache";
import { parseInputCsv, runPipeline, type PostFetcher } from "../../local/localPipelineRunner";

const VAL_CSV = "datasets/big_eval/splits/val.csv";
const INPUT_CACHE_DIR = "datasets/big_eval/_cache";
const WRITER_CACHE_DIR = "datasets/big_eval/_writer_cache";
const SEARCH_CACHE_DIR = "datasets/big_eval/_search_cache";

// Hold writer/search/verifier constant; vary only the note-needed judge model.
// Order matches the request: sonnet 4.6 → deepseek v4 flash → deepseek v4 pro →
// gemini 3.0 flash. Reasoning is already "high" via the cheap-bot base config.
const JUDGE_MODEL_VARIANTS = ["sonnet46", "deepseek-v4flash", "deepseek-v4pro", "gemini3flash"];

process.env.BIG_EVAL_INPUT_CACHE = INPUT_CACHE_DIR;
process.env.CHEAP_BOT_WRITER_CACHE = WRITER_CACHE_DIR;
process.env.SEARCH_CACHE = SEARCH_CACHE_DIR;

function extractTweetId(url: string): string {
  const m = url.match(/status\/(\d+)/);
  if (m) return m[1]!;
  if (/^\d+$/.test(url)) return url;
  throw new Error(`Cannot extract tweet ID from: ${url}`);
}

const fetchPost: PostFetcher = async (input) => {
  const tweetId = extractTweetId(input.url);
  const p = path.join(INPUT_CACHE_DIR, `${tweetId}.json`);
  if (!fs.existsSync(p)) throw new Error(`No cached Post for ${tweetId} (${p})`);
  const cached: CachedInput = JSON.parse(fs.readFileSync(p, "utf8"));
  const post: Post = cached.post;
  return { post, title: post.text.slice(0, 80) };
};

async function main() {
  let inputs = parseInputCsv(VAL_CSV);
  const max = process.env.REPLAY_MAX ? parseInt(process.env.REPLAY_MAX, 10) : undefined;
  if (max) inputs = inputs.slice(0, max);
  console.log(`[replayOffline] ${inputs.length} val rows; judge models: ${JUDGE_MODEL_VARIANTS.join(", ")}`);

  for (const judgeModel of JUDGE_MODEL_VARIANTS) {
    console.log(`\n${"#".repeat(70)}\n# JUDGE MODEL: ${judgeModel}\n${"#".repeat(70)}`);
    await runPipeline({
      scriptName: "replayOffline",
      folderPrefix: "tryout",
      inputs,
      fetchPost,
      forcedPicks: {
        bot: "cheap-bot",
        verifier_media_sources: "accept",
        cheap_bot_judge_model: judgeModel,
      },
      datasetName: `judge-${judgeModel}`,
      concurrency: 5,
      runName: `iter08-judge-${judgeModel}`,
    });
  }

  console.log("\n[replayOffline] all 4 judge-model replays complete.");
}

main().catch((err) => {
  console.error("[replayOffline] Fatal error:", err);
  process.exit(1);
});
