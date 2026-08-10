/**
 * File cache for bot inputs: the media description, the comments and the author
 * history. An entry is keyed by tweet id and by video_description_strategy.
 * The cache only exists when BIG_EVAL_INPUT_CACHE holds a directory path. That
 * variable is unset in production, so production behaviour is unchanged.
 *
 * createBotInput reads the cache before it does any work and writes it before it
 * returns. A hill-climbing run therefore reuses the cached inputs instead of
 * paying the X, Gemini and Grok fetch costs again. The Phase 5 script of big_eval
 * runs createBotInput over the selected tweets for no other reason than to fill
 * this cache.
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

// The in-memory cache is always on. The note-needed prefilter builds a post's
// input first. When the post passes the prefilter, createBotInput reuses that
// input instead of paying a second time for the Gemini media analysis, the Grok
// comment fetch and the author-history query. The key includes the strategy so
// that two strategies never collide. The map only grows with the posts processed
// in one run, and the process is a short-lived cron job, so it needs no eviction.
const memCache = new Map<string, BotInput>();
const memKey = (tweetId: string, strategy: string) => `${tweetId}::${strategy}`;

export function readInputCacheMem(tweetId: string, strategy: string): BotInput | null {
  return memCache.get(memKey(tweetId, strategy)) ?? null;
}

export function writeInputCacheMem(tweetId: string, strategy: string, botInput: BotInput): void {
  memCache.set(memKey(tweetId, strategy), botInput);
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
