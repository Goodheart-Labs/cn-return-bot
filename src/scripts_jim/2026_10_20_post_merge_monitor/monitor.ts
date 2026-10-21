/**
 * Compares the claim checks and X bot runs after a time with the same length of time before it.
 * It shows, per table and per A/B arm, how many runs there were, what a run cost on average,
 * and how they ended. It never reads the logs column, because that column is large.
 *
 *   bun run src/scripts_jim/2026_10_20_post_merge_monitor/monitor.ts --since 2026-10-20T16:00:00Z [--until <ISO>]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const PAGE = 1000;
const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1];
const since = new Date(arg("since"));
const until = process.argv.includes("--until") ? new Date(arg("until")) : new Date();
const before = new Date(since.getTime() - (until.getTime() - since.getTime()));
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface Run { created_at: string; outcome: string | null; outcome_reason: string | null; ab_test_picks: Record<string, string> | null; cost: number | null; kind?: string | null; error_message?: string | null }

async function runs(table: "pipeline_runs" | "everything_pipeline_runs", from: Date, to: Date): Promise<Run[]> {
  const columns = table === "pipeline_runs" ? "created_at, outcome, outcome_reason, ab_test_picks, cost, error_message" : "created_at, outcome, outcome_reason, ab_test_picks, cost, kind";
  const rows: Run[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at").range(start, start + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Run[]));
    if ((data ?? []).length < PAGE) return rows;
  }
}

function summary(rows: Run[], pick: (r: Run) => string): string[] {
  const groups = new Map<string, Run[]>();
  for (const r of rows) groups.set(pick(r), [...(groups.get(pick(r)) ?? []), r]);
  return [...groups.entries()].sort().map(([arm, list]) => {
    const costs = list.map((r) => r.cost).filter((c): c is number => c != null);
    const outcomes: Record<string, number> = {};
    for (const r of list) outcomes[r.outcome ?? "none"] = (outcomes[r.outcome ?? "none"] ?? 0) + 1;
    const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    return `  ${arm.padEnd(22)} n=${String(list.length).padStart(4)}  mean cost $${mean.toFixed(4)}  ${Object.entries(outcomes).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o}:${n}`).join(" ")}`;
  });
}

async function report(label: string, table: "pipeline_runs" | "everything_pipeline_runs") {
  const [now, earlier] = await Promise.all([runs(table, since, until), runs(table, before, since)]);
  const claimOnly = (rs: Run[]) => (table === "everything_pipeline_runs" ? rs.filter((r) => !["extraction", "rating", "other"].includes(r.kind ?? "")) : rs);
  const [a, b] = [claimOnly(now), claimOnly(earlier)];
  const arm = (r: Run) => `cascade=${r.ab_test_picks?.search_cascade ?? "-"} 2nd=${r.ab_test_picks?.second_round ?? "-"}`;
  console.log(`\n== ${label}: ${since.toISOString().slice(0, 16)} to ${until.toISOString().slice(0, 16)} ==`);
  console.log(`after (${a.length} runs):`); summary(a, arm).forEach((l) => console.log(l));
  console.log(`before, same length (${b.length} runs):`); summary(b, (r) => `cascade=${r.ab_test_picks?.search_cascade ?? "-"}`).forEach((l) => console.log(l));
  const writers = new Map<string, number>();
  for (const r of a) writers.set(r.ab_test_picks?.simple_bot_writer ?? "-", (writers.get(r.ab_test_picks?.simple_bot_writer ?? "-") ?? 0) + 1);
  console.log(`writers after: ${[...writers.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`);
  const errors = a.filter((r) => r.outcome === "error").slice(0, 3);
  for (const e of errors) console.log(`  error: ${(e.error_message ?? e.outcome_reason ?? "").slice(0, 160)}`);
}

await report("X bot (pipeline_runs)", "pipeline_runs");
await report("Common Notes claim checks (everything_pipeline_runs)", "everything_pipeline_runs");
