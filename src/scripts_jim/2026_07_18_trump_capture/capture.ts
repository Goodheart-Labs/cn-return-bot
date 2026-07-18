/**
 * Standalone capture of Trump 2020 election-fraud tweets from the eligible feed.
 *
 * DELIBERATELY SELF-CONTAINED: it carries its OWN copy of the predicate and does
 * NOT register a topic in MISINFO_TOPICS. So the production note-writer never
 * sees it, never drafts, never submits — this only READS the feed and SAVES the
 * matches. Zero posting risk, safe even on main.
 *
 * Runs on GitHub Actions (prod X secrets → xxl feed access). Writes a dated
 * JSONL of matched tweets to OUT_DIR, uploaded as an artifact by the workflow.
 * Each run is a fresh snapshot of what's currently eligible; dedup across runs
 * happens downstream (tweet_id is stable).
 *
 * Env: OUT_DIR (default ./capture-out), MAX_PAGES (default 100), FEED_SIZE
 * (default xxl). Uses the same fetchEligiblePosts the bot uses.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchEligiblePosts, type Post } from "../../api/fetchEligiblePosts";
import { buildPostSelection } from "../../pipeline/orchestration/utils/feedSizeStrategy";
import type { FeedSize } from "../../pipeline/ab-testing/botConfig";

// --- Predicate (copied from topics.ts trump_election_fraud; keep in sync) ---
const FRAME =
  /(rigged|rig the|stolen|\bstole\b|\bsteal\b|fraud|fraudulent|flip(ped|ping)?|hacked|manipulat|tamper(ed|ing)?|decertif|overturn(ed|ing)?|ballot stuffing|dead voters|noncitizen|non-?citizen|illegal (vote|ballot|voter)|cheat(ed|ing)?)/;
const OBJECT =
  /(election|\bvote[sd]?\b|\bvoting\b|ballot|voter (roll|file|registration|data)|voting machine|dominion|smartmatic|raffensperger|recount)/;
const ANCHOR =
  /(\b20(16|20|22|24)\b|dominion|smartmatic|raffensperger|voting machines?|voter files?|voter rolls?|non-?citizens?|declassif|220 ?million|deep state|decertif|overturn|stolen election|election was stolen|rigged election|chin(a|ese)|foreign (interference|meddl|power)|mail-?in ballot)/;

function blob(p: Post): string {
  return `${p.text ?? ""}\n${p.referenced_tweet_data?.text ?? ""}`.toLowerCase();
}
function matches(p: Post): boolean {
  const b = blob(p);
  return FRAME.test(b) && OBJECT.test(b) && ANCHOR.test(b);
}

const OUT_DIR = process.env.OUT_DIR ?? "capture-out";
const MAX_PAGES = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : 100;
const FEED_SIZE = (process.env.FEED_SIZE as FeedSize) ?? "xxl";
const STAMP = process.env.RUN_STAMP ?? "run"; // workflow passes a UTC stamp (no Date in-repo)

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // fetchEligiblePosts caps at maxResults; ask for far more than a page so it
  // paginates. 100 posts/page * MAX_PAGES.
  const posts = await fetchEligiblePosts(MAX_PAGES * 100, new Set(), MAX_PAGES, buildPostSelection(FEED_SIZE));
  const hits = posts.filter(matches);

  const jsonlPath = path.join(OUT_DIR, `trump-capture-${STAMP}.jsonl`);
  const out = hits
    .map((p) =>
      JSON.stringify({
        tweet_id: p.id,
        url: `https://x.com/i/status/${p.id}`,
        author: p.author_name ?? null,
        followers: p.author_followers ?? null,
        views: p.public_metrics?.impression_count ?? null,
        created_at: p.created_at ?? null,
        captured_stamp: STAMP,
        text: p.text ?? "",
        quoted_text: p.referenced_tweet_data?.text ?? null,
      }),
    )
    .join("\n");
  fs.writeFileSync(jsonlPath, out + (out ? "\n" : ""));
  fs.writeFileSync(
    path.join(OUT_DIR, `trump-capture-${STAMP}.summary.json`),
    JSON.stringify({ feedSize: FEED_SIZE, crawled: posts.length, matched: hits.length, stamp: STAMP }, null, 2),
  );
  console.log(`[capture] feed=${FEED_SIZE} crawled=${posts.length} matched=${hits.length} → ${jsonlPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
