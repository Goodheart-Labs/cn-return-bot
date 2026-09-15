/**
 * Shows what the gate and split call answers for one stored item, and whether
 * each start sentence it returns can be located in the text. READ-ONLY.
 *
 *   bun run src/scripts_jim/2026_09_14_muse_pipeline_comparison/probeSplit.ts [<item-id>] [--runs N]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { cutText, gateAndSplit, locatePartStarts } from "../../everything/pipeline/gateAndSplit";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";

if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

const DEFAULT_ITEM = "8764d17a-b65c-4789-b0d7-99339f69260f";
const args = process.argv.slice(2);
const runsIdx = args.indexOf("--runs");
const runs = runsIdx === -1 ? 1 : Number(args[runsIdx + 1]);
const itemId = args.find((a, i) => !a.startsWith("--") && i !== runsIdx + 1) ?? DEFAULT_ITEM;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: item } = await db.from("everything_items").select("title,full_text").eq("id", itemId).single();
if (!item?.full_text) throw new Error("item has no stored text");

for (let run = 1; run <= runs; run++) {
  const { verdict, cost } = await withCostTracker(async () => ({
    verdict: await gateAndSplit(item.full_text, item.title ?? undefined),
    cost: aggregateAndLogCosts(),
  }));
  console.log(`\nrun ${run} ($${(cost?.cost ?? 0).toFixed(4)}): ${JSON.stringify(verdict, null, 1)}`);
  if (verdict.kind !== "checkable") continue;
  for (const start of verdict.starts) {
    const found = locatePartStarts(item.full_text, [start]);
    console.log(`  ${found ? "found" : "NOT FOUND"}: ${start.title} — "${start.startExcerpt.slice(0, 80)}"`);
  }
  const cut = cutText(item.full_text, verdict.starts);
  console.log(cut ? `  cut into ${cut.parts.length} parts: ${cut.parts.map((p) => `${p.title} (${p.text.length} chars)`).join(", ")}; intro ${cut.introduction?.length ?? 0} chars` : "  cut failed");
}
