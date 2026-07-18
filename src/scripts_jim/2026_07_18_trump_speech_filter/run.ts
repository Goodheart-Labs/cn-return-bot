/**
 * Investigation: filter the captured feed_tweets pool for tweets amplifying
 * misinformation from Trump's July 16 2026 election-security speech, then open
 * them in the review dashboard so the filter can be eyeballed.
 *
 * This is the misinfo pre-pass's Stage 1 (keyword predicate) + Stage 2 (Opus
 * selection against the speech transcript) run over feed_tweets instead of a
 * live crawl — READ-ONLY on the pipeline side: it writes nothing to X and no
 * note is drafted. Selected tweets are uploaded as a review-dashboard dataset
 * run (reusing the existing NoteCard/TweetCard render path) and the dashboard
 * auto-opens on the fresh upload.
 *
 *   bun run src/scripts_jim/2026_07_18_trump_speech_filter/run.ts [--top N]
 *
 * --top N: rank the keyword matches by recency+impressions and send only the
 * top N to Stage 2 — focuses LLM cost and review effort on the tweets whose
 * notes would matter most.
 *
 * Needs prod SUPABASE_URL/SUPABASE_SERVICE_KEY (feed_tweets + the dashboard live
 * on prod) and OPENROUTER_API_KEY (the selection LLM), all auto-loaded from .env.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { fetchAllRows } from "../../api/paging";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { blob } from "../../pipeline/misinfo-monitoring/keywordFilter";
import { selectPostsNeedingNote, type SelectedPost } from "../../pipeline/misinfo-monitoring/selectPostsNeedingNote";
import { sortByRecencyAndImpressions, ageInHours, formatCount } from "../../pipeline/orchestration/utils/tweetSorting";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
import { autoOpenInDashboard } from "../../local/dashboardAutoOpen";
import { initOutputFolder, buildRunName, OUTPUT_HEADERS } from "../../local/outputWriter";
import { escapeCsvField } from "../../utils/csv";

const TOPIC_ID = "trump_election_security";
// The speech aired 2026-07-16; only look at tweets from the event onward.
const POSTED_SINCE = "2026-07-16";
// Posts per selection call. The transcript is the fixed per-call cost, so bigger
// chunks amortize it — but a chunk with many selections + verbose reasons can
// exceed the model's output budget and truncate the JSON, so keep it moderate.
const SELECT_CHUNK = 50;

interface FeedTweetRow {
  tweet_id: string;
  text: string | null;
  referenced_tweet_data: Post["referenced_tweet_data"] | null;
  posted_at: string | null;
  impressions: number | null;
}

/** Read the whole event-window slice of feed_tweets (keyset-paged past the 1000
 *  cap). Only the columns the filter and ranking need — skips the big
 *  raw_tweet/media blobs. */
function readFeedTweets(client: ReturnType<typeof createClient>): Promise<FeedTweetRow[]> {
  return fetchAllRows<FeedTweetRow>(
    () =>
      client
        .from("feed_tweets")
        .select("tweet_id, text, referenced_tweet_data, posted_at, impressions")
        .gte("posted_at", POSTED_SINCE),
    "tweet_id",
    { label: "trump-filter feed_tweets" },
  );
}

/** feed_tweets row → the minimal Post shape blob()/selection/ranking read. */
function toPost(row: FeedTweetRow): Post {
  return {
    id: row.tweet_id,
    text: row.text ?? "",
    referenced_tweet_data: row.referenced_tweet_data ?? undefined,
    created_at: row.posted_at ?? undefined,
    public_metrics: { impression_count: row.impressions ?? 0 },
  } as Post;
}

/**
 * The dashboard lists dataset items newest-created_at-first, and bulk inserts
 * land in same-timestamp chunks — insertion order alone can't express a ranking.
 * Re-stamp each item's created_at so rank 0 is newest → renders on top.
 */
export async function applyRankOrder(client: ReturnType<typeof createClient>, uploadId: string, rankedTweetIds: string[]): Promise<void> {
  const { data, error } = await client.from("review_dashboard_items").select("id, url").eq("upload_id", uploadId);
  if (error) throw error;
  const rankByTweetId = new Map(rankedTweetIds.map((id, i) => [id, i]));
  const base = Date.now();
  for (const item of data ?? []) {
    const tweetId = (item.url as string).match(/status\/(\d+)/)?.[1];
    const rank = tweetId !== undefined ? rankByTweetId.get(tweetId) : undefined;
    if (rank === undefined) continue;
    const { error: updErr } = await client
      .from("review_dashboard_items")
      .update({ created_at: new Date(base - rank * 1000).toISOString() })
      .eq("id", item.id);
    if (updErr) throw updErr;
  }
}

function csvRow(fields: Partial<Record<(typeof OUTPUT_HEADERS)[number], string>>): string {
  return OUTPUT_HEADERS.map((h) => escapeCsvField(fields[h] ?? "")).join(",");
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY required (prod)");
  // The dashboard auto-open reads prod creds via this getter; capture before use.
  captureProdSupabaseCreds();

  const topic = MISINFO_TOPICS.find((t) => t.id === TOPIC_ID);
  if (!topic) throw new Error(`topic ${TOPIC_ID} not registered in topics.ts`);

  const client = createClient(url, key);
  const rows = await readFeedTweets(client);
  const posts = rows.map(toPost);

  // Stage 1 — keyword cut.
  let matched = posts.filter((p) => topic.matches(blob(p)));
  console.log(`[filter] pool=${posts.length} keyword_matched=${matched.length}`);
  if (!matched.length) {
    console.log("[filter] nothing matched the keyword predicate — done");
    return;
  }

  // --top N: keep only the highest-impact matches (recency+impressions blend).
  const topArgIdx = process.argv.indexOf("--top");
  const topN = topArgIdx >= 0 ? Number(process.argv[topArgIdx + 1]) : undefined;
  if (topN) {
    matched = sortByRecencyAndImpressions(matched).slice(0, topN);
    console.log(`[filter] --top ${topN}: kept the ${matched.length} highest recency+impressions matches`);
  }

  // Stage 2 — LLM selection against the transcript, chunked. A chunk whose
  // JSON stays invalid after retries is skipped (logged), not fatal.
  const selected: SelectedPost[] = [];
  for (let i = 0; i < matched.length; i += SELECT_CHUNK) {
    const chunk = matched.slice(i, i + SELECT_CHUNK);
    try {
      const picked = await selectPostsNeedingNote(topic, chunk);
      selected.push(...picked);
      console.log(`[filter] selection ${i}-${i + chunk.length}: ${picked.length}/${chunk.length} selected`);
    } catch (err) {
      console.warn(`[filter] selection ${i}-${i + chunk.length} FAILED (skipping chunk): ${(err as Error)?.message}`);
    }
  }
  console.log(`[filter] pool=${posts.length} keyword_matched=${matched.length} llm_selected=${selected.length}`);

  // Full record of every Stage-1 match + its verdict, for deeper inspection.
  const reasonById = new Map(selected.map((s) => [s.postId, s.reason]));
  const output = initOutputFolder("trump-filter", "run");
  fs.writeFileSync(
    path.join(output.folderPath, "matched.jsonl"),
    matched
      .map((p) => JSON.stringify({ tweet_id: p.id, selected: reasonById.has(p.id), reason: reasonById.get(p.id) ?? "", text: p.text }))
      .join("\n"),
    "utf8",
  );

  if (!selected.length) {
    console.log(`[filter] Stage 2 selected nothing — no dashboard upload; matches in ${output.folderPath}/matched.jsonl`);
    return;
  }

  // Upload only the selected candidates to the dashboard (the "might be misinfo"
  // set), ranked by the pipeline's recency+impressions blend so the most
  // impactful tweets render first. csvRowToReviewItemInsert maps text→tweet_text,
  // judge_guidance→shown.
  const postById = new Map(matched.map((p) => [p.id, p]));
  const rankedPosts = sortByRecencyAndImpressions(
    selected.map((s) => postById.get(s.postId)!).filter(Boolean),
  );
  for (const post of rankedPosts) {
    const imp = post.public_metrics?.impression_count ?? 0;
    output.appendRow(
      csvRow({
        url: `https://x.com/i/status/${post.id}`,
        text: post.text ?? "",
        needs_note: "true",
        judge_guidance: `[${formatCount(imp)} imp, ${ageInHours(post).toFixed(0)}h old] ${reasonById.get(post.id) ?? ""}`,
      }),
    );
  }

  const uploadId = await autoOpenInDashboard(output.csvPath, buildRunName("trump-filter", "run"));
  if (uploadId) {
    await applyRankOrder(client, uploadId, rankedPosts.map((p) => p.id));
    console.log(`[filter] rank order applied to upload ${uploadId}`);
  }
  console.log(`[filter] uploaded ${selected.length} candidate(s); details in ${output.folderPath}/matched.jsonl`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
