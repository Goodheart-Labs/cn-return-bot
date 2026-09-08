/**
 * GOO-97: does the new rating step (rateClaims.ts) save fact-check money
 * without losing notes?
 *
 * READ-ONLY against prod. For each item it loads the stored text and the stored
 * claims, runs the real rater on them, and compares the new rating of every
 * claim with what the real fact-check produced back then (a note, no note, or
 * a failure). Nothing is written to the database.
 *
 *   bun run src/scripts_jim/2026_09_08_claim_rating_eval/evaluate.ts [<item-id>...]
 *
 * Without arguments it runs the three items chosen in the plan. Per item it
 * prints one line per claim and a totals block, and saves the raw comparison
 * as results/<item-id>.json next to this script.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rateClaims, shouldFactCheck, JUDGEMENTS } from "../../everything/pipeline/rateClaims";
import type { ExtractedClaim } from "../../everything/types";

/** The shared client reads OPENROUTER_API_KEY and builds itself lazily on the
 *  first call, so reassigning the variable here is enough to redirect it. The
 *  pipeline itself never reads OPENROUTER_TESTING_KEY. */
if (process.env.OPENROUTER_TESTING_KEY) {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  console.log("Using OPENROUTER_TESTING_KEY for OpenRouter calls.\n");
}

const DEFAULT_ITEMS = [
  "a9b1de9a-7e63-4866-82a4-20c6ba3d07a5", // AI Is Taking Over Physics and Nobody Talks About It (YouTube)
  "23512ba8-f304-48e1-b81a-a144b13a199f", // Odds and Ends: Why Texas Might Actually Flip (Substack)
  "64247104-b8b4-4a2b-ab66-c2e35e237a26", // Ajeya Cotra: the OpenAI agent swarm that hacked Hugging Face (YouTube)
];

// A stricter gate to report alongside the real one: only claims rated
// "somewhat likely false" or worse would be checked.
const STRICT_CHECK_FROM = JUDGEMENTS.indexOf("somewhat likely false");
const strictCheck = (judgement: string) => (JUDGEMENTS as readonly string[]).indexOf(judgement) >= STRICT_CHECK_FROM;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface ClaimRow {
  id: string;
  claim: string;
  judgement: string;
  status: string;
  status_reason: string | null;
  context_quote: string | null;
  context_paragraph: string | null;
  image_urls: string[];
}

interface Comparison {
  claim: string;
  oldJudgement: string;
  newJudgement: string;
  /** What the real check produced: note, no_note, error, or skipped (never checked). */
  outcome: string;
  outcomeReason: string | null;
  checkCost: number;
}

async function loadItem(itemId: string) {
  const { data: item, error } = await db.from("everything_items").select("title,source,full_text").eq("id", itemId).single();
  if (error || !item) throw new Error(`item ${itemId}: ${error?.message ?? "not found"}`);
  const { data: claims } = await db
    .from("everything_claims")
    .select("id,claim,judgement,status,status_reason,context_quote,context_paragraph,image_urls")
    .eq("item_id", itemId)
    .is("created_by", null)
    .order("created_at");
  const rows = (claims ?? []) as ClaimRow[];
  const { data: runs } = await db.from("everything_pipeline_runs").select("claim_id,cost").in("claim_id", rows.map((r) => r.id));
  const costByClaim = new Map<string, number>();
  for (const r of runs ?? []) costByClaim.set(r.claim_id, (costByClaim.get(r.claim_id) ?? 0) + Number(r.cost ?? 0));
  return { item, rows, costByClaim };
}

function toExtractedClaim(row: ClaimRow): ExtractedClaim {
  return {
    claim: row.claim,
    context: row.context_quote ?? "",
    contextParagraph: row.context_paragraph ?? "",
    imageUrls: row.image_urls ?? [],
    speculation: false,
    anchor: { kind: "substack", url: "" },
  };
}

function summarize(comparisons: Comparison[], gate: (j: string) => boolean) {
  const wasChecked = comparisons.filter((c) => c.outcome !== "skipped");
  const nowSkipped = wasChecked.filter((c) => !gate(c.newJudgement));
  const newlyChecked = comparisons.filter((c) => c.outcome === "skipped" && gate(c.newJudgement));
  return {
    checkedBefore: wasChecked.length,
    costBefore: wasChecked.reduce((s, c) => s + c.checkCost, 0),
    nowSkipped: nowSkipped.length,
    costSaved: nowSkipped.reduce((s, c) => s + c.checkCost, 0),
    notesLost: nowSkipped.filter((c) => c.outcome === "note").map((c) => c.claim),
    newlyChecked: newlyChecked.length,
  };
}

function printSummary(label: string, s: ReturnType<typeof summarize>) {
  console.log(`  ${label}: ${s.nowSkipped} of ${s.checkedBefore} checked claims would now be skipped, saving $${s.costSaved.toFixed(2)} of $${s.costBefore.toFixed(2)}; ${s.newlyChecked} previously skipped claims would now be checked`);
  console.log(`    notes lost: ${s.notesLost.length}`);
  for (const claim of s.notesLost) console.log(`      - ${claim}`);
}

async function evaluateItem(itemId: string) {
  const { item, rows, costByClaim } = await loadItem(itemId);
  console.log(`\n### ${item.title} (${item.source}, ${rows.length} claims, text ${item.full_text?.length ?? 0} chars)`);
  if (!item.full_text) throw new Error("item has no stored text");

  const rating = await rateClaims(item.full_text, rows.map(toExtractedClaim));
  const comparisons: Comparison[] = rows.map((row, i) => ({
    claim: row.claim,
    oldJudgement: row.judgement,
    newJudgement: rating.claims[i]!.judgement,
    outcome: row.status === "skipped" ? "skipped" : row.status,
    outcomeReason: row.status_reason,
    checkCost: costByClaim.get(row.id) ?? 0,
  }));

  console.log(`\nResearch ($${rating.cost.cost.toFixed(2)}, ${rating.webSearches} web searches, ${rating.cost.input_tokens} in / ${rating.cost.output_tokens} out tokens):\n${rating.research}\n`);
  for (const c of comparisons) {
    const check = c.outcome === "skipped" ? "never checked" : `${c.outcome}${c.outcomeReason ? ` (${c.outcomeReason})` : ""} $${c.checkCost.toFixed(2)}`;
    const flag = c.outcome === "note" && !shouldFactCheck(c.newJudgement) ? "  <-- NOTE LOST" : "";
    console.log(`- ${c.oldJudgement} -> ${c.newJudgement} | ${check}${flag}\n    ${c.claim}`);
  }
  console.log(`\nTotals for "${item.title}":`);
  console.log(`  rater cost: $${rating.cost.cost.toFixed(2)}`);
  printSummary("real gate (uncertain and below checked)", summarize(comparisons, shouldFactCheck));
  printSummary("strict gate (somewhat likely false and below checked)", summarize(comparisons, strictCheck));

  mkdirSync(join(import.meta.dir, "results"), { recursive: true });
  writeFileSync(
    join(import.meta.dir, "results", `${itemId}.json`),
    JSON.stringify({ itemId, title: item.title, raterCost: rating.cost, webSearches: rating.webSearches, research: rating.research, comparisons }, null, 2),
  );
}

const itemIds = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ITEMS;
for (const id of itemIds) await evaluateItem(id);
