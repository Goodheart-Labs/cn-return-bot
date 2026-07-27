/**
 * Collect (snapshot, current) impression pairs for three tweet groups:
 *
 *   small     — tweets processed from the small feed (pipeline_runs
 *               ab_test_picks.feed_size = "small"), snapshot = tweets table
 *               (impressions @ last_updated_at). Only tweets >=7 days old,
 *               uniform-sampled across the whole labeled history (since May 16).
 *   large     — same, feed_size = "large"
 *   xxl_dump  — the feed_tweets XXL capture (single snapshot 2026-07-18 14:28),
 *               uniform-sampled across the dump (no age floor; posted_at spans
 *               2013 → Jul 18)
 *
 * Current impressions come from batch GET /2/tweets using Jim's enrolled
 * X_JIMMAAR1_* keys (read-only). Each group is written to data/<group>.csv
 * with both datapoints.
 *
 *   bun run src/scripts_jim/2026_07_22_log_views_experiment/collect.ts
 */

// Two key sets: prod CN keys (free eligible-feed crawl) and Jim's enrolled
// keys (paid /2/tweets lookups — the only ones that endpoint accepts).
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
const PROD_KEYS = Object.fromEntries(X_KEY_SUFFIXES.map((s) => [s, process.env[`X_${s}`]]));
const JIM_KEYS = Object.fromEntries(X_KEY_SUFFIXES.map((s) => [s, process.env[`X_JIMMAAR1_${s}`]]));
const useKeys = (keys: Record<string, string | undefined>) => {
  for (const s of X_KEY_SUFFIXES) process.env[`X_${s}`] = keys[s];
};

import axios from "axios";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { SupabaseLogger } from "../../api/supabaseClient";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const TARGET_PER_GROUP = 1000;
const MIN_AGE_DAYS = 7;
const X_BATCH_SIZE = 100;
// Spend cap: each uncached lookup costs ~$0.005. MAX_LOOKUPS=800 ≈ $4.
const MAX_LOOKUPS = Number(process.env.MAX_LOOKUPS ?? Infinity);
const OUT_DIR = join(import.meta.dir, "data");

const logger = new SupabaseLogger();
const client = (logger as any).client;

const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

/** Every k-th element after sorting — deterministic uniform sample. */
function uniformSample<T>(sorted: T[], n: number): T[] {
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]!);
}

// ---------------------------------------------------------------------------
// DB snapshot points
// ---------------------------------------------------------------------------

interface SnapshotRow {
  tweet_id: string;
  feed: string;
  posted_at: string;
  snapshot_at: string;
  snapshot_impressions: number;
  author_followers: number | null;
}

/** ALL distinct tweet_ids of runs whose feed_size pick matches. */
async function collectRunTweetIds(feedSize: string): Promise<string[]> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let page = 0; ; page++) {
    const { data, error } = await client
      .from("pipeline_runs")
      .select("tweet_id, created_at")
      .contains("ab_test_picks", { feed_size: feedSize })
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`pipeline_runs page ${page} (${feedSize}): ${error.message}`);
    for (const row of data ?? []) ids.add(row.tweet_id);
    if ((data ?? []).length < PAGE) break;
  }
  return [...ids];
}

/** Join to tweets for the stored snapshot, keep >=7d-old tweets, uniform-sample. */
async function fetchTweetSnapshots(tweetIds: string[], feed: string): Promise<SnapshotRow[]> {
  const maxPostedAt = new Date(Date.now() - MIN_AGE_DAYS * 864e5).toISOString();
  const rows: SnapshotRow[] = [];
  for (const ids of chunk(tweetIds, 150)) {
    const { data, error } = await client
      .from("tweets")
      .select("tweet_id, posted_at, impressions, last_updated_at, author_followers")
      .in("tweet_id", ids)
      .lt("posted_at", maxPostedAt);
    if (error) throw new Error(`tweets join (${feed}): ${error.message}`);
    for (const t of data ?? []) {
      if (t.posted_at == null || t.impressions == null || t.last_updated_at == null) continue;
      rows.push({
        tweet_id: t.tweet_id,
        feed,
        posted_at: t.posted_at,
        snapshot_at: t.last_updated_at,
        snapshot_impressions: t.impressions,
        author_followers: t.author_followers,
      });
    }
  }
  rows.sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  return uniformSample(rows, TARGET_PER_GROUP);
}

/** Uniform sample of the feed_tweets XXL capture (sorted by posted_at). */
async function fetchXxlDumpSample(): Promise<SnapshotRow[]> {
  const all = await logger.fetchAllRows<{
    tweet_id: string;
    posted_at: string | null;
    impressions: number | null;
    last_seen_at: string;
    author_followers: number | null;
  }>(
    (c) => c
      .from("feed_tweets")
      .select("tweet_id, posted_at, impressions, last_seen_at, author_followers"),
    "tweet_id",
    "log-views.feed_tweets",
  );
  const usable = all
    .filter((t) => t.posted_at != null && t.impressions != null)
    .sort((a, b) => a.posted_at!.localeCompare(b.posted_at!));
  return uniformSample(usable, TARGET_PER_GROUP).map((t) => ({
    tweet_id: t.tweet_id,
    feed: "xxl_dump",
    posted_at: t.posted_at!,
    snapshot_at: t.last_seen_at,
    snapshot_impressions: t.impressions!,
    author_followers: t.author_followers,
  }));
}

// ---------------------------------------------------------------------------
// Current impressions from the X API (batch lookup, read-only)
// ---------------------------------------------------------------------------

interface CurrentMetrics {
  impressions: number;
  likes: number | null;
  fetched_at: string;
}

const CACHE_PATH = join(OUT_DIR, "current_cache.jsonl");

/** tweet_id → metrics, persisted one JSON line per tweet so a 402/crash never loses work. */
function loadCache(): Map<string, CurrentMetrics | null> {
  const byId = new Map<string, CurrentMetrics | null>();
  if (!existsSync(CACHE_PATH)) return byId;
  for (const line of readFileSync(CACHE_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { tweet_id, metrics } = JSON.parse(line);
    byId.set(tweet_id, metrics); // metrics === null → tweet gone from X
  }
  return byId;
}

/**
 * Free current views for the xxl_dump sample: crawl the whole XXL eligible
 * feed with the prod CN keys (the feed response carries impression_count) and
 * cache current metrics for every sampled tweet still in the feed. Tweets that
 * left the feed stay uncached — they are NOT worth paid lookups.
 */
async function crawlXxlCurrentViews(sampleIds: Set<string>): Promise<void> {
  const cached = loadCache();
  const missing = [...sampleIds].filter((id) => !cached.has(id));
  if (!missing.length) return;
  console.log(`[collect] Crawling XXL feed for ${missing.length} xxl_dump tweets (free, CN keys, test_mode)…`);
  useKeys(PROD_KEYS);
  // Local CN keys lack "earned admission" so test_mode must stay true — that
  // only gates note submission; the feed read (incl. impression_count) is the same.
  const fetchedAt = new Date().toISOString();
  let nextToken: string | undefined;
  let totalPosts = 0, hits = 0;
  for (let page = 0; page < 300; page++) {
    const params = new URLSearchParams({
      "tweet.fields": "public_metrics",
      test_mode: "true",
      max_results: "100",
      post_selection: "feed_size: xxl, feed_lang: en",
    });
    if (nextToken) params.append("pagination_token", nextToken);
    const url = `https://api.x.com/2/notes/search/posts_eligible_for_notes?${params.toString().replace(/\+/g, "%20")}`;
    const response = await axios.get(url, {
      headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
      timeout: 30_000,
    });
    const posts: any[] = response.data?.data ?? [];
    totalPosts += posts.length;
    const lines: string[] = [];
    for (const p of posts) {
      if (!sampleIds.has(p.id) || cached.has(p.id)) continue;
      cached.set(p.id, null); // just to dedupe within the crawl
      hits++;
      lines.push(JSON.stringify({
        tweet_id: p.id,
        metrics: {
          impressions: p.public_metrics?.impression_count ?? 0,
          likes: p.public_metrics?.like_count ?? null,
          fetched_at: fetchedAt,
        } satisfies CurrentMetrics,
      }));
    }
    if (lines.length) appendFileSync(CACHE_PATH, lines.join("\n") + "\n");
    nextToken = response.data?.meta?.next_token;
    if (page % 25 === 0) console.log(`[collect] XXL crawl page ${page + 1}: ${totalPosts} posts seen, ${hits} sample hits`);
    if (!nextToken) break;
  }
  console.log(`[collect] XXL crawl: ${totalPosts} posts in feed, ${hits}/${missing.length} sampled tweets covered`);
}

async function fetchCurrentMetrics(tweetIds: string[]): Promise<Map<string, CurrentMetrics | null>> {
  useKeys(JIM_KEYS); // /2/tweets only works with Jim's enrolled (paid) keys
  const byId = loadCache();
  let todo = tweetIds.filter((id) => !byId.has(id));
  if (todo.length > MAX_LOOKUPS) {
    console.log(`[collect] capping ${todo.length} lookups at MAX_LOOKUPS=${MAX_LOOKUPS} (~$${(MAX_LOOKUPS * 0.005).toFixed(2)})`);
    todo = todo.slice(0, MAX_LOOKUPS);
  }
  console.log(`[collect] ${byId.size} cached, ${todo.length} to fetch`);
  const batches = chunk(todo, X_BATCH_SIZE);
  for (const [i, ids] of batches.entries()) {
    const fullUrl = `https://api.x.com/2/tweets?ids=${ids.join("%2C")}&tweet.fields=public_metrics,created_at`;
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await axios.get(fullUrl, {
          headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
          timeout: 30000,
        });
        break;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 && attempt < 3) {
          const resetAt = Number(err.response.headers["x-rate-limit-reset"]) * 1000;
          const waitMs = Math.max(resetAt - Date.now(), 5000) + 1000;
          console.log(`[collect] 429 on batch ${i + 1}/${batches.length}; waiting ${Math.round(waitMs / 1000)}s`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (status === 402) {
          console.log(`[collect] 402 credits depleted at batch ${i + 1}/${batches.length} — stopping; CSVs get partial coverage. Re-run after topping up credits.`);
          return byId;
        }
        throw new Error(`X batch ${i + 1}/${batches.length}: ${status} ${JSON.stringify(err?.response?.data)?.slice(0, 200)}`);
      }
    }
    const fetchedAt = new Date().toISOString();
    const cacheLines: string[] = [];
    const found = new Set<string>();
    for (const t of response.data?.data ?? []) {
      const metrics: CurrentMetrics = {
        impressions: t.public_metrics?.impression_count ?? 0,
        likes: t.public_metrics?.like_count ?? null,
        fetched_at: fetchedAt,
      };
      byId.set(t.id, metrics);
      found.add(t.id);
      cacheLines.push(JSON.stringify({ tweet_id: t.id, metrics }));
    }
    // Deleted/suspended tweets: cache as null so re-runs don't re-pay for them.
    for (const id of ids) {
      if (found.has(id)) continue;
      byId.set(id, null);
      cacheLines.push(JSON.stringify({ tweet_id: id, metrics: null }));
    }
    appendFileSync(CACHE_PATH, cacheLines.join("\n") + "\n");
    console.log(`[collect] X batch ${i + 1}/${batches.length}: ${found.size}/${ids.length} found`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[collect] X lookup done: ${[...byId.values()].filter(Boolean).length} found, ${[...byId.values()].filter((v) => v === null).length} deleted/inaccessible`);
  return byId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CSV_HEADER =
  "tweet_id,feed,posted_at,snapshot_at,snapshot_impressions,current_at,current_impressions,current_likes,author_followers";

function writeCsv(group: string, rows: SnapshotRow[], current: Map<string, CurrentMetrics | null>): void {
  const lines = [CSV_HEADER];
  let deleted = 0, unfetched = 0;
  for (const r of rows) {
    const cur = current.get(r.tweet_id);
    if (cur === null) { deleted++; continue; }
    if (cur === undefined) { unfetched++; continue; }
    lines.push([
      r.tweet_id, r.feed, r.posted_at, r.snapshot_at, r.snapshot_impressions,
      cur.fetched_at, cur.impressions, cur.likes ?? "", r.author_followers ?? "",
    ].join(","));
  }
  const path = join(OUT_DIR, `${group}.csv`);
  writeFileSync(path, lines.join("\n") + "\n");
  console.log(`[collect] ${path}: ${lines.length - 1} rows (${deleted} gone from X, ${unfetched} not fetched yet)`);
}

/** Freeze each group's sample on first run so re-runs (after credit top-up) align with the cache. */
async function stickySample(group: string, compute: () => Promise<SnapshotRow[]>): Promise<SnapshotRow[]> {
  const path = join(OUT_DIR, `sample_${group}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const rows = await compute();
  writeFileSync(path, JSON.stringify(rows));
  return rows;
}

const ageStats = (rows: SnapshotRow[]) => {
  const days = rows.map((r) => (Date.now() - +new Date(r.posted_at)) / 864e5).sort((a, b) => a - b);
  return `age(d) min=${days[0]?.toFixed(1)} median=${days[Math.floor(days.length / 2)]?.toFixed(1)} mean=${(days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)} max=${days.at(-1)?.toFixed(1)}`;
};

mkdirSync(OUT_DIR, { recursive: true });

const small = await stickySample("small_feed", async () => {
  console.log("[collect] Gathering small-feed tweet ids…");
  return fetchTweetSnapshots(await collectRunTweetIds("small"), "small");
});
console.log(`[collect] small: ${small.length} sampled (>=${MIN_AGE_DAYS}d); ${ageStats(small)}`);

const large = await stickySample("large_feed", async () => {
  console.log("[collect] Gathering large-feed tweet ids…");
  return fetchTweetSnapshots(await collectRunTweetIds("large"), "large");
});
console.log(`[collect] large: ${large.length} sampled (>=${MIN_AGE_DAYS}d); ${ageStats(large)}`);

const xxl = await stickySample("xxl_dump", async () => {
  console.log("[collect] Sampling feed_tweets XXL dump…");
  return fetchXxlDumpSample();
});
console.log(`[collect] xxl_dump: ${xxl.length} sampled; ${ageStats(xxl)}`);

// xxl_dump current views come free from a fresh XXL feed crawl (cached).
await crawlXxlCurrentViews(new Set(xxl.map((r) => r.tweet_id)));

// Paid lookups: small + large by default; xxl_dump only with INCLUDE_XXL_PAID=1
// (the free crawl above can't cover it — test-mode feed is a ~500-post stub —
// so its current views cost ~$5 in credits and need explicit opt-in).
// Rows are sorted by posted_at, so walk them with a coprime stride — any
// capped prefix then still covers the whole age range near-uniformly.
const paidGroups = process.env.INCLUDE_XXL_PAID ? [small, large, xxl] : [small, large];
const interleaved: string[] = [];
for (let k = 0; k < TARGET_PER_GROUP; k++) {
  const i = (k * 997) % TARGET_PER_GROUP;
  for (const rows of paidGroups) if (rows[i]) interleaved.push(rows[i]!.tweet_id);
}
const paidIds = [...new Set(interleaved)];
console.log(`[collect] Fetching current metrics for ${paidIds.length} small/large tweets from X…`);
const current = await fetchCurrentMetrics(paidIds);

writeCsv("small_feed", small, current);
writeCsv("large_feed", large, current);
writeCsv("xxl_dump", xxl, current);
