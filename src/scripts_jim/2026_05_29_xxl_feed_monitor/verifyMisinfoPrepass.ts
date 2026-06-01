/**
 * Offline verification for the XXL-feed misinfo pre-pass.
 *
 * Loads the already-pulled XXL dump (from_actions/feed_dump.jsonl, ~41k posts)
 * and runs the PRODUCTION matchPostsByTopic over it — no live X access needed.
 * Confirms the per-topic keyword counts (esp. that the `\bai\b` word-boundary
 * fix gives ~31 AI-water hits, not the inflated 84 from un-bounded `ai`).
 *
 * With --llm, also runs the production selectPostsNeedingNote on a capped
 * sample per topic and prints the posts it flags as needing a note.
 *
 * Also statically asserts the skip-safety invariant: getSkipTweetIds() must
 * never read misinfo_monitoring_sightings, so merely sighting a post cannot
 * cause the regular pipeline to skip it later.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_05_29_xxl_feed_monitor/verifyMisinfoPrepass.ts
 *   bun run src/scripts_jim/2026_05_29_xxl_feed_monitor/verifyMisinfoPrepass.ts --llm
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Post } from "../../api/fetchEligiblePosts";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { matchPostsByTopic } from "../../pipeline/misinfo-monitoring/keywordFilter";
import { selectPostsNeedingNote } from "../../pipeline/misinfo-monitoring/selectPostsNeedingNote";

const DUMP_PATH = join(import.meta.dir, "from_actions", "feed_dump.jsonl");
const SUPABASE_CLIENT_PATH = join(import.meta.dir, "..", "..", "api", "supabaseClient.ts");
const SIGHTINGS_TABLE = "misinfo_monitoring_sightings";
const LLM_SAMPLE_PER_TOPIC = 25;
// The investigation's `\bai\b`-bounded count for AI-water was ~31; a regression
// to un-bounded `ai` (matching "rain"/"maintain") inflated it past ~80.
const AI_WATER_EXPECTED_MAX = 60;

interface DumpRecord {
  id: string;
  text?: string;
  quoted_text?: string;
}

/** Map a dump record onto the production Post shape. matchPostsByTopic and
 *  selectPostsNeedingNote only read id / text / referenced_tweet_data.text. */
function toPost(rec: DumpRecord): Post {
  return {
    id: rec.id,
    text: rec.text ?? "",
    referenced_tweet_data: rec.quoted_text ? ({ text: rec.quoted_text } as any) : undefined,
  } as Post;
}

function loadDump(): Post[] {
  const lines = readFileSync(DUMP_PATH, "utf8").split("\n").filter((l) => l.trim());
  return lines.map((l) => toPost(JSON.parse(l) as DumpRecord));
}

/** Static guard: the skip set must be built only from notes + pipeline_runs,
 *  never from the sightings table. Reads the getSkipTweetIds() source and fails
 *  if it references the sightings table. */
function assertSkipSafety(): void {
  const src = readFileSync(SUPABASE_CLIENT_PATH, "utf8");
  const start = src.indexOf("async getSkipTweetIds(");
  if (start < 0) throw new Error("getSkipTweetIds not found in supabaseClient.ts");
  const body = src.slice(start, start + 2000);
  if (body.includes(SIGHTINGS_TABLE)) {
    throw new Error(`SKIP-SAFETY VIOLATION: getSkipTweetIds references ${SIGHTINGS_TABLE}`);
  }
  console.log(`✓ skip-safety: getSkipTweetIds does not read ${SIGHTINGS_TABLE} (sighting alone can't poison skips)`);
}

async function main() {
  const runLlm = process.argv.includes("--llm");

  assertSkipSafety();

  const posts = loadDump();
  console.log(`\nLoaded ${posts.length} posts from ${DUMP_PATH}\n`);

  const matched = matchPostsByTopic(posts);
  console.log("Keyword matches per topic:");
  for (const topic of MISINFO_TOPICS) {
    const hits = matched.get(topic.id) ?? [];
    console.log(`  ${topic.id.padEnd(18)} ${hits.length}`);
  }

  const aiWater = matched.get("ai_water")?.length ?? 0;
  if (aiWater > AI_WATER_EXPECTED_MAX) {
    throw new Error(
      `AI-water count ${aiWater} exceeds ${AI_WATER_EXPECTED_MAX} — the \\bai\\b word-boundary fix likely regressed`,
    );
  }
  console.log(`\n✓ ai_water count ${aiWater} <= ${AI_WATER_EXPECTED_MAX} (\\bai\\b boundary holding)`);

  if (!runLlm) {
    console.log("\n(skipping selection LLM — pass --llm to run it)");
    return;
  }

  console.log(`\nRunning selection LLM (capped at ${LLM_SAMPLE_PER_TOPIC} posts/topic):`);
  for (const topic of MISINFO_TOPICS) {
    const hits = (matched.get(topic.id) ?? []).slice(0, LLM_SAMPLE_PER_TOPIC);
    if (!hits.length) continue;
    const selected = await selectPostsNeedingNote(topic, hits);
    console.log(`\n${topic.id}: ${selected.length}/${hits.length} flagged as needing a note`);
    for (const s of selected.slice(0, 5)) {
      const post = hits.find((p) => p.id === s.postId);
      console.log(`  - ${s.postId}: ${s.reason}`);
      console.log(`      "${(post?.text ?? "").replace(/\s+/g, " ").slice(0, 120)}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
