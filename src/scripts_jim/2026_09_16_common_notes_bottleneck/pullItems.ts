/**
 * Pulls every everything_items row that was worked in the last N days, with
 * its claims and its cost rows, and writes them as JSON to the scratchpad so
 * the timing analysis can run locally without hitting prod again.
 *
 *   bun run src/scripts_jim/2026_09_16_common_notes_bottleneck/pullItems.ts <days> <out.json>
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const days = Number(process.argv[2] ?? 7);
const out = process.argv[3] ?? "items.json";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - days * 86400_000).toISOString();

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const items = await all((a, b) =>
  db.from("everything_items")
    .select("id, url, title, source, status, priority, checked_scope, created_at, started_at, processed_at, published_at, retries, skip_reason, error, project_id")
    .or(`started_at.gte.${since},created_at.gte.${since}`)
    .range(a, b),
);
const itemIds = items.map((i) => i.id);
const claims: any[] = [];
const runs: any[] = [];
for (let i = 0; i < itemIds.length; i += 100) {
  const slice = itemIds.slice(i, i + 100);
  claims.push(...(await all((a, b) => db.from("everything_claims").select("id, item_id, status, status_reason, judgement, created_at").in("item_id", slice).range(a, b))));
  runs.push(...(await all((a, b) => db.from("everything_pipeline_runs").select("id, item_id, claim_id, kind, cost, created_at, outcome, final_stage").in("item_id", slice).range(a, b))));
}
const claimIds = claims.map((c) => c.id);
for (let i = 0; i < claimIds.length; i += 100) {
  const slice = claimIds.slice(i, i + 100);
  runs.push(...(await all((a, b) => db.from("everything_pipeline_runs").select("id, item_id, claim_id, kind, cost, created_at, outcome, final_stage").in("claim_id", slice).range(a, b))));
}
const { data: schedule } = await db.from("everything_feed_schedule").select("*");
const { data: projects } = await db.from("everything_projects").select("id, slug, feed_url, priority_until");
await Bun.write(out, JSON.stringify({ pulledAt: new Date().toISOString(), since, items, claims, runs, schedule, projects }, null, 1));
console.log(`${items.length} items, ${claims.length} claims, ${runs.length} runs → ${out}`);
