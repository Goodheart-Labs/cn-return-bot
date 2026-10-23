/**
 * Looks up, read-only, where each of Jim's datapoints from the GOO-229 comments
 * sits in production: the claims whose quote, passage or restatement contains a
 * distinctive phrase of it, and the item they belong to.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/findSnippets.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SNIPPETS: Record<string, string> = {
  berkeley_as: "number of As is up by 30",
  givewell_1500x: "1500x less improvement",
  sol_subagents: "inability to select appropriate subagents",
  sol_destructive: "alarming destructive behavior",
  opus_values: "leans toward caution",
  czechoslovakia: "Nazis spared Jewish doctors",
  yudkowsky_writer: "Yudkowsky is a writer and not a scientist",
  ea_creed: "by creed, says you should seek more money",
  cfar_ftx: "wired to CFAR",
  cam_girls: "recruited her sisters as cam girls",
  impossible_to_prove: "nearly impossible to prove",
  terrorism: "acts of terrorism that he believes",
  melanie_mitchell: "Melanie Mitchell is a computer scientist",
  ea_beholden: "not directly beholden to Yudkowsky",
};

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

for (const [key, phrase] of Object.entries(SNIPPETS)) {
  const pattern = `"%${phrase}%"`;
  const { data, error } = await db
    .from("everything_claims")
    .select("id, item_id, status, claim")
    .or(`context_quote.ilike.${pattern},context_paragraph.ilike.${pattern},claim.ilike.${pattern}`)
    .limit(10);
  if (error) throw error;
  console.log(`\n## ${key}: ${data!.length} claim(s)`);
  for (const c of data!) console.log(`  claim ${c.id} item ${c.item_id} [${c.status}] ${c.claim.slice(0, 110)}`);
}
