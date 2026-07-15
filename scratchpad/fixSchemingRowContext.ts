/**
 * One-off: set context_paragraph for the single ai-2040 claim the automated
 * backfills couldn't reach — the "22x / 12% / 18%" risk-table row, whose header
 * labels and cell values are ~90 lines apart in the HTML→markdown source so no
 * contiguous window matches. We reconstruct the row + its explanation verbatim
 * from 05-supplements__alignment-roadmap.md.
 *
 *   bun run scratchpad/fixSchemingRowContext.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";

const PARAGRAPH =
  "Table — AI R&D Speedup · Marginal Risk · P(Scheming) · Notes:\n\n" +
  "22x · 12% · 18% · At this point, AIs can automate all of AI R&D, and so all the above " +
  "threat models are concerning. We think that, under these assumptions, the correct strategy is to: " +
  "Start practicing AI control immediately by implementing AI control protocols for internal deployment " +
  "of AI systems.";

async function main() {
  const sb = getSupabaseClient();
  const { data: claims, error } = await sb
    .from("everything_claims")
    .select("id, context_quote")
    .eq("status", "note")
    .is("context_paragraph", null);
  if (error) throw error;

  const target = (claims ?? []).find((c) => /P\(Scheming\)|Scheming/i.test(c.context_quote));
  if (!target) return console.log("No matching null-context claim found (already fixed?).");

  const { error: updateError } = await sb
    .from("everything_claims")
    .update({ context_paragraph: PARAGRAPH })
    .eq("id", target.id);
  if (updateError) throw updateError;
  console.log(`✓ set context_paragraph for: ${target.context_quote.slice(0, 70)}…`);
}

await main();
