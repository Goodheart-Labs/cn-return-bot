/**
 * File cache for bot inputs (media description, comments, author history), keyed by
 * tweet id + video_description_strategy. Gated by the BIG_EVAL_INPUT_CACHE env var
 * (path to a directory) — unset in production, so behavior is unchanged there.
 *
 * Used by createBotInput: read at the top (hill-climbing reuses cached inputs so it
 * doesn't re-pay X/Gemini/Grok fetch cost), write before returning (populates the
 * cache). The big_eval Phase-5 script drives createBotInput over the selected tweets
 * purely to fill this cache.
 */
import * as fs from "fs";
import * as path from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import type { BotInput } from "./createBotInput";

const CACHE_ENV = "BIG_EVAL_INPUT_CACHE";

export interface CachedInput {
  tweet_id: string;
  video_description_strategy: string;
  cached_at: string;
  post: Post;
  botInput: BotInput;
}

function cacheDir(): string | null {
  return process.env[CACHE_ENV] || null;
}

export function readInputCache(tweetId: string, strategy: string): BotInput | null {
  const dir = cacheDir();
  if (!dir) return null;
  const p = path.join(dir, `${tweetId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const c: CachedInput = JSON.parse(fs.readFileSync(p, "utf8"));
    return c.video_description_strategy === strategy ? c.botInput : null;
  } catch {
    return null;
  }
}

export function writeInputCache(post: Post, strategy: string, botInput: BotInput): void {
  const dir = cacheDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const cached: CachedInput = {
    tweet_id: post.id,
    video_description_strategy: strategy,
    cached_at: new Date().toISOString(),
    post,
    botInput,
  };
  fs.writeFileSync(path.join(dir, `${post.id}.json`), JSON.stringify(cached, null, 2));
}
