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
 *   B. Agentic (multi-agent / claude-simple): logs.media.gemini.{tweetMedia,
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

const PAGE_SIZE = 500;

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
      out.media = tweet.media
        .map((m: any) => {
          const type = normalizeMediaType(m?.type);
          if (!type || !m?.url) return null;
          return { ...m, type } as RawMedia;
        })
        .filter((m): m is RawMedia => m !== null);
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

  // Update tweets with extracted log data
  const tweetIds = [...best.keys()];
  let updated = 0;
  let errors = 0;
  for (let i = 0; i < tweetIds.length; i += 100) {
    const slice = tweetIds.slice(i, i + 100);
    await Promise.all(
      slice.map(async (tid) => {
        const e = best.get(tid)!;
        const update: Record<string, unknown> = {};
        if (e.media) update.media = e.media;
        if (e.referenced_tweet_data) update.referenced_tweet_data = e.referenced_tweet_data;
        if (e.referenced_tweets) update.referenced_tweets = e.referenced_tweets;
        if (e.posted_at) update.posted_at = e.posted_at;
        if (e.author_name) update.author_name = e.author_name;
        if (e.author_description) update.author_description = e.author_description;
        if (e.author_tweet_count != null) update.author_tweet_count = e.author_tweet_count;
        if (e.text) update.text = e.text;
        if (Object.keys(update).length === 0) return;
        const { error } = await client.from("tweets").update(update).eq("tweet_id", tid);
        if (error) {
          console.error(`[backfill] Error updating ${tid}: ${error.message}`);
          errors++;
        } else {
          updated++;
        }
      }),
    );
  }

  // Bot identity updates on pipeline_runs.
  let botUpdated = 0;
  for (let i = 0; i < botUpdates.length; i += 100) {
    const slice = botUpdates.slice(i, i + 100);
    await Promise.all(
      slice.map(async (b) => {
        const update: Record<string, unknown> = {};
        if (b.name) update.bot_name = b.name;
        if (b.nameLong) update.bot_name_long = b.nameLong;
        if (b.config) update.bot_config = b.config;
        if (Object.keys(update).length === 0) return;
        const { error } = await client.from("pipeline_runs").update(update).eq("id", b.id);
        if (!error) botUpdated++;
      }),
    );
  }

  console.log(`[backfill] Done. Updated ${updated} tweets (${errors} errors); ${botUpdated} pipeline_runs bot-identity-backfilled`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
