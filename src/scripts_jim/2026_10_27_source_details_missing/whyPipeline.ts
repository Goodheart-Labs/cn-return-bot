import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Shows how the items of the pipeline's recent notes reached the pipeline: their hand-back rows,
 *  which give the reason Claude handed each one over. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const CLAIM_IDS_SINCE = "2026-10-22";

const { data: runs, error } = await db
  .from("everything_pipeline_runs")
  .select("claim_id, created_at, everything_claims!inner(item_id, everything_items!inner(id, url, priority, created_at, status))")
  .eq("kind", "check")
  .gte("created_at", CLAIM_IDS_SINCE)
  .limit(1000);
if (error) throw error;

const items = new Map<string, unknown>();
for (const r of runs) {
  const claim = r.everything_claims as unknown as { item_id: string; everything_items: unknown };
  items.set(claim.item_id, claim.everything_items);
}
console.log(`pipeline check runs since ${CLAIM_IDS_SINCE}: ${runs.length}, items: ${items.size}`);
const { data: handbacks, error: e2 } = await db.from("everything_claude_handbacks").select("*").in("item_id", [...items.keys()]);
if (e2) throw e2;
for (const [id, item] of items) console.log(JSON.stringify(item), JSON.stringify(handbacks.find((h) => h.item_id === id) ?? null));

