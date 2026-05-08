/**
 * Backfill tweets.{media, referenced_tweet_data, posted_at, author_*} from
 * pipeline_runs.logs.
 *
 * Migration 032 already populated tweets from the scalar columns on
 * pipeline_runs (text, has_video, engagement counts, ...). This script picks
 * up the JSONB-only fields that the dashboard's extractMedia needs.
 *
 * Handles three log shapes:
 *   A. New (post-Post-PR): logs.tweet.media[] is the raw X-API media list
 *      ({type:"photo"|"video"|"animated_gif", url, ...}). logs.tweet.referencedTweetData
 *      carries the quoted-tweet payload.
 *   B. Agentic (multi-agent / simple-bot): logs.media.gemini.{tweetMedia,
 *      quotedTweetMedia}[] — items have {type:"image"|"video", url, description}.
 *   C. Legacy: logs.media.images[] and logs.media.videos[] — flat URL lists,
 *      no type field; we synthesize {type:"photo", url} / {type:"video", url}.
 *
 * For each tweet_id we pick the FIRST shape that has any media, in the
 * order above. If we find tweet text/createdAt that's better than what's
 * already in the row, we update those too.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_backfill_tweets_from_logs/main.ts --local
 *   bun run src/scripts_jim/2026_05_01_backfill_tweets_from_logs/main.ts        # prod
 */

import "dotenv/config";

const useLocal = process.argv.includes("--local");
if (useLocal) {
  const url = process.env.LOCAL_SUPABASE_URL;
  const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("--local requires LOCAL_SUPABASE_URL and LOCAL_SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_KEY = key;
}

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Small page size because pipeline_runs.logs is JSONB with multi-KB blobs
// per row. 500/page (the previous value) hits Supabase's statement_timeout
// on prod. 100 stays safely under it. Trade-off: 5x more requests, still
// finishes in a couple minutes.
const PAGE_SIZE = 100;

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

type RawMedia = { type: string; url?: string; [k: string]: unknown };

type Extracted = {
  media?: RawMedia[];
  referenced_tweet_data?: Record<string, unknown>;
  referenced_tweets?: unknown[];
  posted_at?: string;
  text?: string;
  author_name?: string;
  author_description?: string;
  author_tweet_count?: number;
};

function normalizeMediaType(raw: string | undefined): "photo" | "video" | "animated_gif" | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (t === "photo" || t === "image") return "photo";
  if (t === "video") return "video";
  if (t === "animated_gif" || t === "gif") return "animated_gif";
  return undefined;
}

function extractFromLogs(logs: any): Extracted {
  const out: Extracted = {};
  if (!logs || typeof logs !== "object") return out;

  // tweet metadata that all shapes carry
  const tweet = logs.tweet;
  if (tweet && typeof tweet === "object") {
    if (typeof tweet.text === "string") out.text = tweet.text;
    if (typeof tweet.createdAt === "string") out.posted_at = tweet.createdAt;
    // Shape A: raw X-API media on logs.tweet.media (only present after the
    // Post-passing PR lands)
    if (Array.isArray(tweet.media) && tweet.media.length > 0) {
      const mapped = tweet.media.map((m: any): RawMedia | null => {
        const type = normalizeMediaType(m?.type);
        if (!type || !m?.url) return null;
        return { ...m, type };
      });
      out.media = mapped.filter((m: RawMedia | null): m is RawMedia => m !== null);
    }
    if (tweet.referencedTweetData && typeof tweet.referencedTweetData === "object") {
      out.referenced_tweet_data = tweet.referencedTweetData;
    }
    if (Array.isArray(tweet.referencedTweets)) {
      out.referenced_tweets = tweet.referencedTweets;
    }
  }

  // Author metadata from logs.inputs.author (Post-passing PR)
  const author = logs.inputs?.author;
  if (author && typeof author === "object") {
    if (typeof author.name === "string") out.author_name = author.name;
    if (typeof author.description === "string") out.author_description = author.description;
    if (typeof author.tweetCount === "number") out.author_tweet_count = author.tweetCount;
  }

  if (out.media && out.media.length > 0) return out;

  // Shape B: gemini analyzer output
  const gemini = logs.media?.gemini;
  if (gemini && typeof gemini === "object") {
    const items: RawMedia[] = [];
    for (const m of gemini.tweetMedia ?? []) {
      const type = normalizeMediaType(m?.type);
      if (type && m?.url) items.push({ type, url: m.url });
    }
    if (items.length > 0) {
      out.media = items;
      // The gemini analyzer also stores quoted-tweet media in a parallel field.
      // Without referencedTweetData.text we only synthesize the media half.
      if (Array.isArray(gemini.quotedTweetMedia) && gemini.quotedTweetMedia.length > 0) {
        const qmedia = gemini.quotedTweetMedia
          .map((m: any) => {
            const type = normalizeMediaType(m?.type);
            return type && m?.url ? { type, url: m.url } : null;
          })
          .filter(Boolean);
        if (qmedia.length > 0) {
          out.referenced_tweet_data = { ...(out.referenced_tweet_data ?? {}), media: qmedia };
        }
      }
      return out;
    }
  }

  // Shape C: legacy flat lists
  const media = logs.media;
  if (media && typeof media === "object") {
    const items: RawMedia[] = [];
    for (const img of media.images ?? []) {
      if (img?.url) items.push({ type: "photo", url: img.url });
    }
    for (const vid of media.videos ?? []) {
      if (vid?.url) items.push({ type: "video", url: vid.url });
    }
    if (items.length > 0) out.media = items;
  }

  return out;
}

async function fetchRunsBatch(client: SupabaseClient, offset: number) {
  const { data, error } = await client
    .from("pipeline_runs")
    .select("id, tweet_id, created_at, logs, bot_name, bot_name_long")
    .order("created_at", { ascending: true })
    .not("logs", "is", null)
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return data ?? [];
}

function extractBotIdentity(logs: any): { name?: string; nameLong?: string; config?: any } {
  if (!logs || typeof logs !== "object") return {};
  const bot = logs.bot;
  if (!bot || typeof bot !== "object") return {};
  const out: { name?: string; nameLong?: string; config?: any } = {};
  if (typeof bot.id === "string") out.nameLong = bot.id;
  if (typeof bot.name === "string") out.name = bot.name;
  else if (typeof bot.id === "string") out.name = bot.id.split("_")[0];
  if (bot.config && typeof bot.config === "object") out.config = bot.config;
  return out;
}

async function main() {
  console.log(`[backfill] Source: ${process.env.SUPABASE_URL}`);

  // Best per tweet_id: first non-empty extraction wins (oldest run that had
  // the data — keeps semantics stable on re-run).
  const best: Map<string, Extracted> = new Map();
  // Per pipeline_run bot identity backfill (only for runs that don't have it)
  const botUpdates: Array<{ id: string; name?: string; nameLong?: string; config?: any }> = [];
  // Track tweets that need to exist (even minimally) because some pipeline_run
  // referenced them — covers the case where the synced pipeline_runs has
  // tweet_ids that aren't in tweets yet.
  const seenTweetIds = new Set<string>();

  let offset = 0;
  let scanned = 0;
  while (true) {
    const rows = await fetchRunsBatch(client, offset);
    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      if (r.tweet_id) seenTweetIds.add(r.tweet_id);

      // Bot identity from logs.bot.* — only fill in when the column is null.
      if (r.bot_name == null || r.bot_name_long == null) {
        const id = extractBotIdentity(r.logs);
        if (id.name || id.nameLong || id.config) {
          botUpdates.push({ id: r.id, ...id });
        }
      }

      if (!r.tweet_id) continue;
      const existing = best.get(r.tweet_id);
      if (existing?.media && existing.media.length > 0) continue;
      const extracted = extractFromLogs(r.logs);
      if (Object.keys(extracted).length === 0) continue;
      const merged: Extracted = { ...(existing ?? {}) };
      for (const [k, v] of Object.entries(extracted)) {
        if (v != null && (merged as any)[k] == null) (merged as any)[k] = v;
      }
      best.set(r.tweet_id, merged);
    }
    offset += rows.length;
    if (offset % 5000 === 0 || rows.length < PAGE_SIZE) {
      console.log(`[backfill]   scanned ${scanned} runs, have data for ${best.size} tweets`);
    }
    if (rows.length < PAGE_SIZE) break;
  }

  console.log(`[backfill] Scanned ${scanned} runs total; ${best.size} tweets with extractable data; ${botUpdates.length} pipeline_runs need bot-identity backfill`);

  // Ensure a tweets row exists for every tweet_id we saw in pipeline_runs.
  // (It might not, if the pipeline_runs row came from a sync after migration
  // 032's column-driven backfill ran on stale data.)
  const now = new Date().toISOString();
  const minimalTweetRows = [...seenTweetIds].map((tweet_id) => ({
    tweet_id, first_seen_at: now, last_updated_at: now,
  }));
  for (let i = 0; i < minimalTweetRows.length; i += 200) {
    const batch = minimalTweetRows.slice(i, i + 200);
    await client.from("tweets").upsert(batch, { onConflict: "tweet_id", ignoreDuplicates: true });
  }
  console.log(`[backfill] Ensured tweets rows for ${minimalTweetRows.length} pipeline_run tweet_ids`);

  // author_handle backfill from scraped_notewriter_snapshots.tweet_handle.
  // Reasoning: pipeline_runs stored author_id (numeric) but never the handle,
  // and the X API doesn't return it for the tweets we process. The scraper,
  // by walking the notewriter page, did capture the handle on each snapshot.
  // For every tweet_id we have a snapshot for, lift the latest non-null
  // tweet_handle into tweets.author_handle.
  const handleRows: Array<{ tweet_id: string; tweet_handle: string }> = [];
  let snapOffset = 0;
  while (true) {
    const { data, error } = await client
      .from("scraped_notewriter_snapshots")
      .select("tweet_id, tweet_handle, scraped_at")
      .not("tweet_handle", "is", null)
      .not("tweet_id", "is", null)
      .order("scraped_at", { ascending: false })
      .range(snapOffset, snapOffset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    handleRows.push(...(data as any));
    if (data.length < PAGE_SIZE) break;
    snapOffset += data.length;
  }
  // Latest snapshot wins (we ordered DESC so the first occurrence is latest).
  const handleByTweetId = new Map<string, string>();
  for (const r of handleRows) {
    if (!handleByTweetId.has(r.tweet_id)) handleByTweetId.set(r.tweet_id, r.tweet_handle);
  }
  // Group-by-shape bulk upsert. Each row has a different subset of populated
  // fields, but in practice only a handful of distinct shapes show up across
  // the whole run (e.g. {media,text,posted_at} is one shape, {text,posted_at,
  // author_name,author_description} is another). Grouping by shape lets us
  // bulk-upsert each group: every row in a batch has the same column set, so
  // PostgREST doesn't clobber other columns with NULLs. Result is ~5–10
  // requests for the whole job instead of 12k+ — much gentler on the pooler.
  const BULK_BATCH = 500;
  async function bulkUpsertByShape(
    table: string,
    rows: Array<Record<string, unknown>>,
    pkColumn: string,
  ): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;
    // Group by sorted-keys signature (excluding the PK).
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) {
      const sig = Object.keys(r).filter((k) => k !== pkColumn).sort().join("|");
      if (!sig) continue; // PK only, nothing to update
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(r);
    }
    for (const [sig, groupRows] of groups) {
      for (let i = 0; i < groupRows.length; i += BULK_BATCH) {
        const batch = groupRows.slice(i, i + BULK_BATCH);
        const { error } = await client.from(table).upsert(batch, { onConflict: pkColumn });
        if (error) {
          console.error(`[backfill] Error upserting ${table} group "${sig}" batch ${i / BULK_BATCH}: ${error.message}`);
          errors += batch.length;
        } else {
          updated += batch.length;
        }
      }
    }
    return { updated, errors };
  }

  // 1. author_handle from snapshots — uniform shape.
  const handleRowsForUpsert = [...handleByTweetId.entries()].map(([tweet_id, author_handle]) => ({
    tweet_id, author_handle,
  }));
  const handleResult = await bulkUpsertByShape("tweets", handleRowsForUpsert, "tweet_id");
  console.log(`[backfill] Backfilled author_handle on ${handleResult.updated} tweets (${handleResult.errors} errors)`);

  // 2. Rich data from logs — heterogeneous shapes, group-then-upsert.
  const richRows: Array<Record<string, unknown>> = [];
  for (const [tid, e] of best.entries()) {
    const row: Record<string, unknown> = { tweet_id: tid };
    if (e.media) row.media = e.media;
    if (e.referenced_tweet_data) row.referenced_tweet_data = e.referenced_tweet_data;
    if (e.referenced_tweets) row.referenced_tweets = e.referenced_tweets;
    if (e.posted_at) row.posted_at = e.posted_at;
    if (e.author_name) row.author_name = e.author_name;
    if (e.author_description) row.author_description = e.author_description;
    if (e.author_tweet_count != null) row.author_tweet_count = e.author_tweet_count;
    if (e.text) row.text = e.text;
    richRows.push(row);
  }
  const richResult = await bulkUpsertByShape("tweets", richRows, "tweet_id");

  // 3. Bot identity on pipeline_runs — heterogeneous shapes (bot_name +
  // bot_name_long always together; bot_config sometimes present, sometimes not).
  const botRows: Array<Record<string, unknown>> = [];
  for (const b of botUpdates) {
    const row: Record<string, unknown> = { id: b.id };
    if (b.name) row.bot_name = b.name;
    if (b.nameLong) row.bot_name_long = b.nameLong;
    if (b.config) row.bot_config = b.config;
    botRows.push(row);
  }
  const botResult = await bulkUpsertByShape("pipeline_runs", botRows, "id");

  console.log(`[backfill] Done. Updated ${richResult.updated} tweets (${richResult.errors} errors); ${botResult.updated} pipeline_runs bot-identity-backfilled (${botResult.errors} errors)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
