/**
 * Read-only measurement for GOO-81 (fact-check each creator's top posts of
 * all time). It answers two questions against the prod database:
 *   1. How many creators do we follow, and of which type?
 *   2. What does one item cost us on average today?
 *
 * Usage: bun run src/scripts_jim/2026_09_01_top_posts/measureScale.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";

function throwOnError<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

async function main() {
  const db = getSupabaseClient();

  const feeds = throwOnError(
    await db
      .from("everything_followed_feeds")
      .select("project_slug, feed_type, feed_url, priority")
      .order("priority", { ascending: false })
      .order("sort_order"),
  ) as { project_slug: string; feed_type: string; feed_url: string; priority: number }[];
  console.log(`Followed feeds: ${feeds.length}`);
  for (const f of feeds) {
    console.log(`  [${f.feed_type}] priority ${f.priority}  ${f.project_slug}  ${f.feed_url}`);
  }

  const { count: donePageCount, error: countErr } = await db
    .from("everything_items")
    .select("id", { count: "exact", head: true })
    .eq("status", "done")
    .eq("checked_scope", "page");
  if (countErr) throw new Error(countErr.message);
  console.log(`\nItems done with a whole-page check: ${donePageCount}`);

  const totalCost = throwOnError(
    await db.rpc("everything_cost_since", { since: "2020-01-01T00:00:00Z" }),
  ) as number | string | null;
  console.log(`Total LLM cost recorded in everything_pipeline_runs: $${Number(totalCost ?? 0).toFixed(2)}`);
  if (donePageCount && donePageCount > 0) {
    console.log(`Average cost per done page item: $${(Number(totalCost ?? 0) / donePageCount).toFixed(2)}`);
  }

  const { count: claimCount, error: claimErr } = await db
    .from("everything_claims")
    .select("id", { count: "exact", head: true });
  if (claimErr) throw new Error(claimErr.message);
  console.log(`Claims total: ${claimCount}`);
}

main();
