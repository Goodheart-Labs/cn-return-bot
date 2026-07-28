/**
 * Analyze how quickly we submit notes after tweets are created.
 * Uses X API to look up tweet creation times, then compares to our submission times.
 * Maps results against Slaughter et al. (PNAS 2025) effectiveness quartiles.
 */
import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Nathan's personal X API keys (bot account doesn't have tweet read access)
const apiKey = process.env.X_NATHANPMYOUNG_API_KEY!;
const apiSecret = process.env.X_NATHANPMYOUNG_API_KEY_SECRET!;
const accessToken = process.env.X_NATHANPMYOUNG_ACCESS_TOKEN!;
const accessSecret = process.env.X_NATHANPMYOUNG_ACCESS_TOKEN_SECRET!;

const oauth = new OAuth({
  consumer: { key: apiKey, secret: apiSecret },
  signature_method: "HMAC-SHA1",
  hash_function(base_string: string, key: string) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});
const token = { key: accessToken, secret: accessSecret };

// Slaughter et al. (PNAS 2025) effectiveness quartiles
const QUARTILES = [
  { label: "< 12 hours", maxHours: 12, growthReduction: "49.4%", overallReduction: "24.7%" },
  { label: "12–23 hours", maxHours: 23, growthReduction: "43.3%", overallReduction: "11.9%" },
  { label: "23–47 hours", maxHours: 47, growthReduction: "38.4%", overallReduction: "4.2%" },
  { label: "47+ hours", maxHours: Infinity, growthReduction: "1.5%", overallReduction: "~0%" },
];

async function fetchAllRows<T>(query: (client: typeof supabase) => any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await query(supabase).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows;
}

async function lookupTweets(tweetIds: string[]): Promise<{ found: Map<string, Date>; deleted: Set<string> }> {
  const found = new Map<string, Date>();
  const deleted = new Set<string>();

  for (let i = 0; i < tweetIds.length; i += 100) {
    const batch = tweetIds.slice(i, i + 100);
    const url = `https://api.x.com/2/tweets?ids=${batch.join(",")}&tweet.fields=created_at`;
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: "GET" }, token));

    const response = await fetch(url, {
      method: "GET",
      headers: { ...authHeader, "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.warn(`Tweet lookup batch failed: HTTP ${response.status}`);
      continue;
    }

    const data = (await response.json()) as any;
    if (data.data) {
      for (const tweet of data.data) {
        found.set(tweet.id, new Date(tweet.created_at));
      }
    }
    if (data.errors) {
      for (const err of data.errors) {
        deleted.add(err.resource_id || err.value);
      }
    }

    // Rate limit courtesy
    if (i + 100 < tweetIds.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { found, deleted };
}

// Twitter snowflake ID → creation timestamp
function snowflakeToDate(id: string): Date {
  const TWITTER_EPOCH = 1288834974657n;
  const snowflake = BigInt(id);
  const timestamp = (snowflake >> 22n) + TWITTER_EPOCH;
  return new Date(Number(timestamp));
}

async function main() {
  // 1. Get all submitted notes with their tweet_id and submitted_at
  const notes = await fetchAllRows<{
    tweet_id: string;
    submitted_at: string | null;
    cn_status: string | null;
  }>((client) =>
    client.from("notes").select("tweet_id, submitted_at, cn_status")
  );
  console.log(`Found ${notes.length} submitted notes`);

  // 2. Get pipeline_runs for fallback timing (when we first saw each tweet)
  const pipelineRuns = await fetchAllRows<{
    tweet_id: string;
    created_at: string;
  }>((client) =>
    client.from("pipeline_runs").select("tweet_id, created_at").eq("outcome", "submitted")
  );
  const pipelineFirstSeen = new Map<string, Date>();
  for (const run of pipelineRuns) {
    const t = new Date(run.created_at);
    const existing = pipelineFirstSeen.get(run.tweet_id);
    if (!existing || t < existing) {
      pipelineFirstSeen.set(run.tweet_id, t);
    }
  }

  // 3. Try X API first, fall back to snowflake IDs
  const tweetIds = [...new Set(notes.map((n) => n.tweet_id))];
  console.log(`Looking up ${tweetIds.length} unique tweets via X API...`);
  const { found: tweetCreatedAt, deleted } = await lookupTweets(tweetIds);

  // For any tweets not found via API, use snowflake ID timestamp
  let snowflakeCount = 0;
  for (const id of tweetIds) {
    if (!tweetCreatedAt.has(id)) {
      tweetCreatedAt.set(id, snowflakeToDate(id));
      snowflakeCount++;
    }
  }
  console.log(`API: ${tweetCreatedAt.size - snowflakeCount}, Snowflake fallback: ${snowflakeCount}, Deleted: ${deleted.size}`);

  // 4. Compute response times
  type NoteResult = {
    tweet_id: string;
    tweetCreated: Date;
    noteSubmitted: Date;
    responseHours: number;
    source: "api" | "snowflake";
    cn_status: string | null;
  };

  const results: NoteResult[] = [];

  for (const note of notes) {
    if (!note.submitted_at) continue;
    const noteSubmitted = new Date(note.submitted_at);
    const tweetCreated = tweetCreatedAt.get(note.tweet_id);

    if (tweetCreated) {
      const responseHours = (noteSubmitted.getTime() - tweetCreated.getTime()) / (1000 * 60 * 60);
      if (responseHours >= 0) {
        results.push({
          tweet_id: note.tweet_id,
          tweetCreated,
          noteSubmitted,
          responseHours,
          source: deleted.has(note.tweet_id) ? "snowflake" : "api",
          cn_status: note.cn_status,
        });
      }
    }
  }

  // 5. Stats
  results.sort((a, b) => a.responseHours - b.responseHours);
  const hours = results.map((r) => r.responseHours);

  console.log(`\n${"=".repeat(60)}`);
  console.log("RESPONSE TIME ANALYSIS");
  console.log(`${"=".repeat(60)}`);
  console.log(`Notes with timing data: ${results.length}`);
  console.log(`  Via API: ${results.filter(r => r.source === "api").length}`);
  console.log(`  Via snowflake ID: ${results.filter(r => r.source === "snowflake").length}`);

  if (hours.length > 0) {
    const median = hours[Math.floor(hours.length / 2)];
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const p10 = hours[Math.floor(hours.length * 0.1)];
    const p90 = hours[Math.floor(hours.length * 0.9)];

    console.log(`\nResponse time (tweet created → note submitted):`);
    console.log(`  Median: ${median.toFixed(1)} hours`);
    console.log(`  Mean:   ${mean.toFixed(1)} hours`);
    console.log(`  P10:    ${p10.toFixed(1)} hours`);
    console.log(`  P90:    ${p90.toFixed(1)} hours`);

    // Quartile buckets (Slaughter et al.)
    console.log(`\nSlaughter et al. (PNAS 2025) effectiveness quartiles:`);
    console.log(`${"Quartile".padEnd(16)} ${"Count".padEnd(8)} ${"% Ours".padEnd(10)} ${"Overall repost reduction".padEnd(28)}`);
    console.log(`${"-".repeat(62)}`);

    for (const q of QUARTILES) {
      const count = results.filter(
        (r) => r.responseHours < q.maxHours && (q.maxHours === 12 || r.responseHours >= (QUARTILES[QUARTILES.indexOf(q) - 1]?.maxHours ?? 0))
      ).length;
      const pct = ((count / results.length) * 100).toFixed(1);
      console.log(`${q.label.padEnd(16)} ${String(count).padEnd(8)} ${(pct + "%").padEnd(10)} ${q.overallReduction}`);
    }
  }

  // Breakdown by outcome
  const statuses = ["CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL", "NEEDS_MORE_RATINGS"];
  const statusLabels: Record<string, string> = {
    "CURRENTLY_RATED_HELPFUL": "Helpful",
    "CURRENTLY_RATED_NOT_HELPFUL": "Not Helpful",
    "NEEDS_MORE_RATINGS": "NMR",
  };

  console.log(`\nResponse time by outcome:`);
  console.log(`${"Status".padEnd(16)} ${"Count".padEnd(8)} ${"Median hrs".padEnd(12)} ${"Mean hrs".padEnd(12)} ${"<12h".padEnd(8)}`);
  console.log(`${"-".repeat(56)}`);

  for (const status of statuses) {
    const subset = results.filter((r) => r.cn_status === status);
    if (subset.length === 0) continue;
    const h = subset.map((r) => r.responseHours).sort((a, b) => a - b);
    const med = h[Math.floor(h.length / 2)];
    const avg = h.reduce((a, b) => a + b, 0) / h.length;
    const fast = subset.filter((r) => r.responseHours < 12).length;
    const fastPct = ((fast / subset.length) * 100).toFixed(0) + "%";
    console.log(`${(statusLabels[status] || status).padEnd(16)} ${String(subset.length).padEnd(8)} ${med.toFixed(1).padEnd(12)} ${avg.toFixed(1).padEnd(12)} ${fastPct.padEnd(8)}`);
  }

  // Also show null/unknown status
  const nullStatus = results.filter((r) => !r.cn_status || !statuses.includes(r.cn_status));
  if (nullStatus.length > 0) {
    const h = nullStatus.map((r) => r.responseHours).sort((a, b) => a - b);
    const med = h[Math.floor(h.length / 2)];
    const avg = h.reduce((a, b) => a + b, 0) / h.length;
    const fast = nullStatus.filter((r) => r.responseHours < 12).length;
    const fastPct = ((fast / nullStatus.length) * 100).toFixed(0) + "%";
    console.log(`${"Unknown".padEnd(16)} ${String(nullStatus.length).padEnd(8)} ${med.toFixed(1).padEnd(12)} ${avg.toFixed(1).padEnd(12)} ${fastPct.padEnd(8)}`);
  }

  // Deleted tweet stats
  const deletedCount = results.filter((r) => deleted.has(r.tweet_id)).length;
  if (deletedCount > 0) {
    const deletedHours = results.filter((r) => deleted.has(r.tweet_id)).map((r) => r.responseHours).sort((a, b) => a - b);
    console.log(`\nDeleted tweets (${deletedCount}, using snowflake timestamps):`);
    console.log(`  Median response time: ${deletedHours[Math.floor(deletedHours.length / 2)].toFixed(1)} hours`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("PITCH SUMMARY");
  console.log(`${"=".repeat(60)}`);
  if (hours.length > 0) {
    const median = hours[Math.floor(hours.length / 2)];
    const fastCount = results.filter((r) => r.responseHours < 12).length;
    const fastPct = ((fastCount / results.length) * 100).toFixed(0);
    console.log(`Our median response time: ${median.toFixed(1)} hours`);
    console.log(`Human median (Chuai et al.): ~15 hours (80% of retweets already happened)`);
    console.log(`${fastPct}% of our notes land in the fastest quartile (<12h, 24.7% repost reduction)`);
    console.log(`Notes arriving after 47h have essentially zero effect (Slaughter et al. PNAS 2025)`);
  }
}

main().catch(console.error);
