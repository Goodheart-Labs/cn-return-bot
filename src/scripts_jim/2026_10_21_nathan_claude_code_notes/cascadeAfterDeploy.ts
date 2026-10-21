// Counts the search_cascade arm of every Common Notes check that started after
// a deploy, to confirm that all of them take the cascading path (GOO-498).
// Usage: bun run src/scripts_jim/2026_10_21_nathan_claude_code_notes/cascadeAfterDeploy.ts <ISO time>
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = process.argv[2];
if (!since) throw new Error("Pass the deploy time as an ISO timestamp");

const { data, error } = await db
  .from("everything_pipeline_runs")
  .select("ab_test_picks")
  .eq("kind", "check")
  .gte("created_at", since)
  .limit(1000);
if (error) throw error;

const countsByArm: Record<string, number> = {};
for (const run of data) {
  const arm = String((run.ab_test_picks as Record<string, string> | null)?.search_cascade ?? "none");
  countsByArm[arm] = (countsByArm[arm] ?? 0) + 1;
}
console.log(JSON.stringify({ since, checks: data.length, countsByArm }));
