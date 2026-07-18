/**
 * Standalone capture of Trump 2020 election-fraud tweets from the eligible feed.
 *
 * DELIBERATELY SELF-CONTAINED: it carries its OWN copy of the predicate and does
 * NOT register a topic in MISINFO_TOPICS. So the production note-writer never
 * sees it, never drafts, never submits — this only READS the feed and SAVES the
 * matches. Zero posting risk, safe even on main.
 *
 * Runs on GitHub Actions (prod X secrets → xxl feed access). Full-feed pull,
 * then APPENDS only tweet_ids not already in captures.jsonl (git-scraping): the
 * workflow commits the grown store back to the repo, so it accumulates a unique,
 * deduped dataset over time — ready to analyze straight from git.
 *
 * Env: MAX_PAGES (default 300 — enough to exhaust the feed), FEED_SIZE (default
 * xxl), RUN_STAMP (UTC stamp the workflow passes, recorded as first_seen). Uses
 * the same fetchEligiblePosts the bot uses.
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

const MAX_PAGES = process.env.MAX_PAGES ? Number(process.env.MAX_PAGES) : 300;
const FEED_SIZE = (process.env.FEED_SIZE as FeedSize) ?? "xxl";
const STAMP = process.env.RUN_STAMP ?? "manual"; // workflow passes a UTC stamp

// Accumulating, DEDUPED store, committed back to the repo (git-scraping). Each
// run reads it, pulls the full feed, and APPENDS only tweet_ids not already
// present — re-seen tweets are a no-op, so the file grows with unique tweets.
// Kept OUT of scripts_jim/ (whose *.jsonl is gitignored) so it can be committed.
// Resolved from cwd = repo root (the workflow runs `bun run src/.../capture.ts`).
const STORE = path.join(process.cwd(), "capture-data", "trump-election-fraud.jsonl");

function loadSeen(): Set<string> {
  if (!fs.existsSync(STORE)) return new Set();
  const ids = new Set<string>();
  for (const line of fs.readFileSync(STORE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      ids.add((JSON.parse(line) as { tweet_id: string }).tweet_id);
    } catch {
      /* skip a malformed line rather than lose the whole store */
    }
  }
  return ids;
}

async function main() {
  const seen = loadSeen();
  // fetchEligiblePosts caps at maxResults; ask for far more than a page so it
  // paginates the full feed. 100 posts/page * MAX_PAGES.
  const posts = await fetchEligiblePosts(MAX_PAGES * 100, new Set(), MAX_PAGES, buildPostSelection(FEED_SIZE));
  const hits = posts.filter(matches);
  const fresh = hits.filter((p) => !seen.has(p.id));

  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  const lines = fresh
    .map((p) =>
      JSON.stringify({
        tweet_id: p.id,
        url: `https://x.com/i/status/${p.id}`,
        author_name: p.author_name ?? null,
        author_followers: p.author_followers ?? null,
        views: p.public_metrics?.impression_count ?? null,
        tweet_created_at: p.created_at ?? null,
        first_seen: STAMP,
        text: p.text ?? "",
        quoted_text: p.referenced_tweet_data?.text ?? null,
      }),
    )
    .join("\n");
  if (lines) fs.appendFileSync(STORE, lines + "\n");

  console.log(
    `[capture] feed=${FEED_SIZE} crawled=${posts.length} matched=${hits.length} new=${fresh.length} total=${seen.size + fresh.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
