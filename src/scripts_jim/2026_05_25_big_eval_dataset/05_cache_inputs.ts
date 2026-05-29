/**
 * Phase 5: pre-cache bot inputs (tweet, media description, comments, author history)
 * for every selected tweet, so annotation and later hill-climbing reuse them instead
 * of re-paying X/Gemini/Grok fetch cost.
 *
 * Drives createBotInput with BIG_EVAL_INPUT_CACHE set; the inputCache hook writes
 * datasets/big_eval/inputs/<tweet_id>.json. Resumable (skips already-cached tweets).
 *
 *   bun run src/scripts_jim/2026_05_25_big_eval_dataset/05_cache_inputs.ts [--max N] [--concurrency N]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import * as fs from "fs";
import * as path from "path";

// Remap a per-user X credential set → standard X_* vars (Jim's keys take priority).
const X_KEY_PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
for (const prefix of X_KEY_PREFIXES) {
  if (!X_KEY_SUFFIXES.every((s) => process.env[`${prefix}_${s}`])) continue;
  for (const s of X_KEY_SUFFIXES) process.env[`X_${s}`] = process.env[`${prefix}_${s}`];
  console.log(`[cache] Using X credentials: ${prefix}`);
  break;
}

const BIG_EVAL = path.resolve(import.meta.dir, "../../../datasets/big_eval");
const INPUTS_DIR = path.join(BIG_EVAL, "inputs");
process.env.BIG_EVAL_INPUT_CACHE = INPUTS_DIR;

import { fetchTweetById } from "../../api/fetchTweetById";
import { createBotInput } from "../../pipeline/input/createBotInput";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";

const CONFIG: BotConfig = { ...DEFAULT_CONFIG, botId: "simple-bot", video_description_strategy: "frames" };

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

function selectedTweetIds(): string[] {
  const lines = fs.readFileSync(path.join(BIG_EVAL, "selected.jsonl"), "utf8").trim().split("\n");
  const ids = new Set<string>();
  for (const ln of lines) {
    const tid = JSON.parse(ln).tweet_id;
    if (tid) ids.add(String(tid));
  }
  return [...ids];
}

function logSkip(tweetId: string, reason: string): void {
  fs.appendFileSync(path.join(INPUTS_DIR, "_skipped.jsonl"),
    JSON.stringify({ tweet_id: tweetId, reason, at: new Date().toISOString() }) + "\n");
}

async function cacheOne(tweetId: string): Promise<"ok" | "skip" | "cached"> {
  if (fs.existsSync(path.join(INPUTS_DIR, `${tweetId}.json`))) return "cached";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const post = await fetchTweetById(tweetId);
      await withBotConfig(CONFIG, () => createBotInput(post, tweetId));
      return "ok";
    } catch (err: any) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      logSkip(tweetId, err?.message ?? String(err));
      return "skip";
    }
  }
  return "skip";
}

async function main() {
  fs.mkdirSync(INPUTS_DIR, { recursive: true });
  let ids = selectedTweetIds();
  const max = arg("--max", 0);
  if (max > 0) ids = ids.slice(0, max);
  const concurrency = arg("--concurrency", 4);
  console.log(`[cache] ${ids.length} tweets, concurrency ${concurrency}, strategy ${CONFIG.video_description_strategy}`);

  const counts = { ok: 0, skip: 0, cached: 0 };
  let next = 0, done = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++]!;
      const res = await cacheOne(id);
      counts[res]++;
      if (++done % 25 === 0 || done === ids.length) {
        console.log(`[cache] ${done}/${ids.length}  ok=${counts.ok} cached=${counts.cached} skip=${counts.skip}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[cache] DONE  ok=${counts.ok} cached=${counts.cached} skip=${counts.skip}`);
}

main().catch((err) => { console.error("[cache] fatal:", err); process.exit(1); });
