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
 *   bun run src/scripts_jim/2026_07_18_trump_speech_filter/run.ts
 *
 * Needs prod SUPABASE_URL/SUPABASE_SERVICE_KEY (feed_tweets + the dashboard live
 * on prod) and OPENROUTER_API_KEY (the Opus selector), all auto-loaded from .env.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { fetchAllRows } from "../../api/paging";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { blob } from "../../pipeline/misinfo-monitoring/keywordFilter";
import { selectPostsNeedingNote, type SelectedPost } from "../../pipeline/misinfo-monitoring/selectPostsNeedingNote";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
import { autoOpenInDashboard } from "../../local/dashboardAutoOpen";
import { initOutputFolder, buildRunName, OUTPUT_HEADERS } from "../../local/outputWriter";
import { escapeCsvField } from "../../utils/csv";

const TOPIC_ID = "trump_election_security";
// The speech aired 2026-07-16; only look at tweets from the event onward.
const POSTED_SINCE = "2026-07-16";
const SELECT_CHUNK = 100; // posts per Opus selection call (transcript is the
// fixed per-call cost, so bigger chunks amortize it; output stays small).

interface FeedTweetRow {
  tweet_id: string;
  text: string | null;
  referenced_tweet_data: Post["referenced_tweet_data"] | null;
}

/** Read the whole event-window slice of feed_tweets (keyset-paged past the 1000
 *  cap). Only the columns Stage 1/2 need — skips the big raw_tweet/media blobs. */
function readFeedTweets(client: ReturnType<typeof createClient>): Promise<FeedTweetRow[]> {
  return fetchAllRows<FeedTweetRow>(
    () =>
      client
        .from("feed_tweets")
        .select("tweet_id, text, referenced_tweet_data")
        .gte("posted_at", POSTED_SINCE),
    "tweet_id",
    { label: "trump-filter feed_tweets" },
  );
}

/** feed_tweets row → the minimal Post shape blob()/selection read. */
function toPost(row: FeedTweetRow): Post {
  return { id: row.tweet_id, text: row.text ?? "", referenced_tweet_data: row.referenced_tweet_data ?? undefined } as Post;
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
  if (!topic.transcript) throw new Error(`transcripts/${TOPIC_ID}.md missing — Stage 2 needs the transcript`);

  const client = createClient(url, key);
  const rows = await readFeedTweets(client);
  const posts = rows.map(toPost);

  // Stage 1 — keyword cut.
  const matched = posts.filter((p) => topic.matches(blob(p)));
  console.log(`[filter] pool=${posts.length} keyword_matched=${matched.length}`);
  if (!matched.length) {
    console.log("[filter] nothing matched the keyword predicate — done");
    return;
  }

  // Stage 2 — Opus selection against the transcript, chunked.
  const selected: SelectedPost[] = [];
  for (let i = 0; i < matched.length; i += SELECT_CHUNK) {
    const chunk = matched.slice(i, i + SELECT_CHUNK);
    const picked = await selectPostsNeedingNote(topic, chunk);
    selected.push(...picked);
    console.log(`[filter] selection ${i}-${i + chunk.length}: ${picked.length}/${chunk.length} selected`);
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
  // set). csvRowToReviewItemInsert maps text→tweet_text, judge_guidance→shown.
  const textById = new Map(matched.map((p) => [p.id, p.text ?? ""]));
  for (const s of selected) {
    output.appendRow(
      csvRow({
        url: `https://x.com/i/status/${s.postId}`,
        text: textById.get(s.postId) ?? "",
        needs_note: "true",
        judge_guidance: s.reason,
      }),
    );
  }

  await autoOpenInDashboard(output.csvPath, buildRunName("trump-filter", "run"));
  console.log(`[filter] uploaded ${selected.length} candidate(s); details in ${output.folderPath}/matched.jsonl`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
