/**
 * Re-rank an existing review-dashboard dataset run by the pipeline's
 * recency+impressions blend (for uploads made before run.ts ranked its output).
 *
 *   bun run src/scripts_jim/2026_07_18_trump_speech_filter/resortUpload.ts <uploadId>
 *
 * Joins the upload's items back to feed_tweets for posted_at/impressions,
 * computes the same ordering run.ts uses, and re-stamps item created_at so the
 * dashboard renders the ranking.
 */

import { createClient } from "@supabase/supabase-js";
import type { Post } from "../../api/fetchEligiblePosts";
import { fetchInBatches } from "../../api/paging";
import { sortByWeightedScore } from "../../pipeline/orchestration/utils/tweetSorting";
import { applyRankOrder, RECENCY_AND_IMPRESSIONS_WEIGHTS } from "./run";

const uploadId = process.argv[2];
if (!uploadId) {
  console.error("usage: bun run resortUpload.ts <uploadId>");
  process.exit(1);
}

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: items, error } = await client.from("review_dashboard_items").select("url").eq("upload_id", uploadId);
if (error) throw error;
const tweetIds = (items ?? [])
  .map((i) => (i.url as string).match(/status\/(\d+)/)?.[1])
  .filter((id): id is string => !!id);

const rows = await fetchInBatches<{ tweet_id: string; posted_at: string | null; impressions: number | null }>(
  (chunk) => client.from("feed_tweets").select("tweet_id, posted_at, impressions").in("tweet_id", chunk),
  tweetIds,
  { label: "resortUpload feed_tweets" },
);

const posts = rows.map(
  (r) =>
    ({
      id: r.tweet_id,
      created_at: r.posted_at ?? undefined,
      public_metrics: { impression_count: r.impressions ?? 0 },
    }) as Post,
);
const ranked = sortByWeightedScore(posts, RECENCY_AND_IMPRESSIONS_WEIGHTS).map((p) => p.id);
await applyRankOrder(client, uploadId, ranked);
console.log(`[resort] re-ranked ${ranked.length} of ${items?.length ?? 0} item(s) in upload ${uploadId}`);
