/**
 * Prints the web_fetch tool results of one pipeline_runs row, so a suspicious
 * result size can be inspected by eye. Usage:
 *   bun run src/scripts_jim/2026_09_16_search_harness_research/peekFetch.ts <run-id> [chars]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2]!;
const chars = Number(process.argv[3] ?? 1500);
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.from("pipeline_runs").select("logs->note_writer_steps->search").eq("id", runId).single();
if (error) throw error;
const search = (data as any).search;
for (const [turn, tools] of Object.entries<any>(search.turn ?? {})) {
  for (const [name, call] of Object.entries<any>(tools)) {
    if (!name.startsWith("web_fetch")) continue;
    const result = typeof call.result === "string" ? call.result : JSON.stringify(call.result);
    console.log(`\n=== turn ${turn} ${name} ${call.args?.url} (${result.length} chars, ${call.durationMs} ms)\n${result.slice(0, chars)}\n...\n${result.slice(-300)}`);
  }
}
