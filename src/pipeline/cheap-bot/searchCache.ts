/**
 * A disk-backed search cache for cheap-bot. It saves the raw SearXNG results for
 * each query, so hill-climbing iterations can replay a search without hitting
 * Brave or SearXNG again.
 *
 * The SEARCH_CACHE env var turns the cache on. Its value is a path to a
 * directory. When the variable is unset nothing is cached.
 */
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { SearxngResult } from "../tool-calling/searxng";

const CACHE_ENV = "SEARCH_CACHE";

interface CachedSearch {
  query: string;
  cached_at: string;
  results: SearxngResult[];
}

function cacheDir(): string | null {
  return process.env[CACHE_ENV] || null;
}

function cacheKey(query: string): string {
  return createHash("md5").update(query).digest("hex");
}

export function readSearchCache(query: string): SearxngResult[] | null {
  const dir = cacheDir();
  if (!dir) return null;
  const p = path.join(dir, `${cacheKey(query)}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const c: CachedSearch = JSON.parse(fs.readFileSync(p, "utf8"));
    return c.results;
  } catch {
    return null;
  }
}

export function writeSearchCache(query: string, results: SearxngResult[]): void {
  const dir = cacheDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const cached: CachedSearch = { query, cached_at: new Date().toISOString(), results };
  fs.writeFileSync(path.join(dir, `${cacheKey(query)}.json`), JSON.stringify(cached, null, 2));
}
