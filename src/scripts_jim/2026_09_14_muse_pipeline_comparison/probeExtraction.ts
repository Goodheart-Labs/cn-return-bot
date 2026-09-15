/**
 * Runs extraction on the first N characters of one stored item and prints how
 * many claims it found and which ones it marked very confident. Cheap way to
 * try a prompt change without the whole article. READ-ONLY.
 *
 *   bun run src/scripts_jim/2026_09_14_muse_pipeline_comparison/probeExtraction.ts [<item-id>] [--chars N]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractClaims } from "../../everything/pipeline/extractClaims";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";

if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

const DEFAULT_ITEM = "8764d17a-b65c-4789-b0d7-99339f69260f";
const DEFAULT_CHARS = 12_000;
const args = process.argv.slice(2);
const charsIdx = args.indexOf("--chars");
const chars = charsIdx === -1 ? DEFAULT_CHARS : Number(args[charsIdx + 1]);
const itemId = args.find((a, i) => !a.startsWith("--") && i !== charsIdx + 1) ?? DEFAULT_ITEM;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: item } = await db.from("everything_items").select("title,url,full_text").eq("id", itemId).single();
if (!item?.full_text) throw new Error("item has no stored text");

const text = item.full_text.slice(0, chars);
const { result, cost } = await withCostTracker(async () => ({
  result: await extractClaims({ kind: "substack", url: item.url, title: item.title ?? "", text }, 1, false),
  cost: aggregateAndLogCosts(),
}));
if (result.kind === "not_checkable") throw new Error(`gate declined: ${result.reason}`);
const claims = result.parts.flatMap((p) => p.claims);
const confident = claims.filter((c) => c.veryConfidentTrue);
console.log(`${text.length} chars: ${claims.length} claims, ${confident.length} very confident ($${(cost?.cost ?? 0).toFixed(4)})\n`);
const dir = join(import.meta.dir, "results-decker", itemId);
mkdirSync(dir, { recursive: true });
const outFile = join(dir, `probe-extraction-${chars}.json`);
writeFileSync(
  outFile,
  JSON.stringify(
    {
      chars: text.length,
      costUsd: cost?.cost ?? null,
      claimCount: claims.length,
      veryConfidentCount: confident.length,
      claims: claims.map((c) => ({ claim: c.claim, very_confident_that_its_true: c.veryConfidentTrue, context_quote: c.context })),
    },
    null,
    2,
  ),
);
console.log(`wrote ${outFile}\n`);
for (const c of confident) console.log(`  ✓ ${c.claim}`);
console.log("\nnot flagged:");
for (const c of claims.filter((c) => !c.veryConfidentTrue)) console.log(`  · ${c.claim}`);
