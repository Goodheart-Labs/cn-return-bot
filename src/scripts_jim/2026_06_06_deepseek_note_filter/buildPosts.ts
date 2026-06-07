/**
 * Reconstruct the original Post for each dataset row from its pipeline_runs
 * logs (logs.tweet.post — the tweet exactly as the run saw it, incl. media URLs
 * and quoted-tweet data). Writes posts.json keyed by runId. The filter then runs
 * createBotInput fresh on each Post to recompute the full input (media analysis,
 * comments, author history) — so the filter sees what simple-bot saw.
 *
 *   bun run src/scripts_jim/2026_06_06_deepseek_note_filter/buildPosts.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchInBatches } from "../../api/paging";
import type { Post } from "../../api/fetchEligiblePosts";

interface DatasetRow {
  runId: string;
  tweetId: string;
  label: string;
}

async function main() {
  const dir = import.meta.dir;
  const dataset: DatasetRow[] = JSON.parse(readFileSync(join(dir, "dataset.json"), "utf8"));
  const runIds = dataset.map((r) => r.runId);

  const client = getSupabaseClient();
  const rows = await fetchInBatches<{ id: string; tweet_id: string; logs: any }>(
    (chunk) => client.from("pipeline_runs").select("id, tweet_id, logs").in("id", chunk),
    runIds,
    { label: "buildPosts.logs" },
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const posts: { runId: string; tweetId: string; post: Post }[] = [];
  const missing: { runId: string; tweetId: string; reason: string }[] = [];
  let withMedia = 0;
  for (const row of dataset) {
    const run = byId.get(row.runId);
    const post = run?.logs?.tweet?.post;
    if (!post || typeof post.id !== "string") {
      missing.push({ runId: row.runId, tweetId: row.tweetId, reason: run ? "no logs.tweet.post" : "run not found" });
      continue;
    }
    if ((post.media?.length ?? 0) > 0 || (post.referenced_tweet_data?.media?.length ?? 0) > 0) withMedia++;
    posts.push({ runId: row.runId, tweetId: row.tweetId, post });
  }

  writeFileSync(join(dir, "posts.json"), JSON.stringify(posts, null, 2));
  console.log(`Reconstructed ${posts.length}/${dataset.length} posts (${withMedia} with media). Missing: ${missing.length}`);
  if (missing.length) console.log(JSON.stringify(missing, null, 2));
}

main().then(() => process.exit(0));
