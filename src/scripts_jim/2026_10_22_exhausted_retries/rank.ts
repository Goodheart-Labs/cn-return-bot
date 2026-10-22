// Lists the feed posts that used up their attempts, in the order the walk
// would pick them again if their retry counts were reset: creators in walk
// rank, and within a creator newest first (orderCandidates).
// Run: bun run src/scripts_jim/2026_10_22_exhausted_retries/rank.ts [count]
import "dotenv/config";
import { fetchAllRows } from "../../everything-core/paging";
import { normalizeFeedUrl } from "../../everything-core/pageUrls";
import { getSupabaseClient } from "../../api/supabaseClient";
import { rankCreators } from "../../everything/creatorRanking";
import { MAX_ITEM_RETRIES } from "../../everything/autoEnqueue";
import { QUEUE_PRIORITY } from "../../everything/db";

const DEFAULT_COUNT = 40;
const count = Number(process.argv[2] ?? DEFAULT_COUNT);

type Row = { id: string; url: string; title: string | null; published_at: string | null; error: string | null; everything_projects: { feed_url: string | null } | null };
const rows = await fetchAllRows<Row>(
  () =>
    getSupabaseClient()
      .from("everything_items")
      .select("id, url, title, published_at, error, everything_projects(feed_url)")
      .eq("status", "error")
      .gte("retries", MAX_ITEM_RETRIES)
      .lt("priority", QUEUE_PRIORITY.requested),
  "id",
);
const ranked = await rankCreators();
const rankOf = new Map(ranked.map((c, i) => [normalizeFeedUrl(c.feed_url), i]));
const creatorOf = new Map(ranked.map((c) => [normalizeFeedUrl(c.feed_url), c]));

const walked = rows
  .map((r) => ({ ...r, key: r.everything_projects?.feed_url ? normalizeFeedUrl(r.everything_projects.feed_url) : null }))
  .filter((r) => r.key !== null && rankOf.has(r.key))
  .sort((a, b) => rankOf.get(a.key!)! - rankOf.get(b.key!)! || (b.published_at ?? "").localeCompare(a.published_at ?? ""));

console.log(`${rows.length} exhausted feed posts. ${walked.length} belong to a creator the walk ranks; the rest would never be picked again.\n`);
for (const [i, r] of walked.slice(0, count).entries()) {
  const c = creatorOf.get(r.key!)!;
  const why = c.prioritized ? "priority" : `score ${c.score.visitors_per_post.toFixed(2)}`;
  console.log(`${i + 1}. [${c.project_slug}, rank ${rankOf.get(r.key!)! + 1}, ${why}] ${r.published_at?.slice(0, 10) ?? "undated"} ${r.title ?? r.url}\n   ${r.url}\n   error: ${(r.error ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
}
