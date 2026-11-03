import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../everything-core/paging";

/** What the Claude runs on Nathan's ai-box would have cost with an Anthropic API key (GOO-694).
 *
 *  Every Claude the ai-box runner started wrote one everything_claude_runs row with the cost Claude Code
 *  reported for it. Claude Code reports what the run would have cost at API prices, even when it ran on
 *  a subscription. The runner's last Claude ended at 2026-10-31 22:17 UTC, so the window ends there.
 *  The script prints the cost per UTC day and per tag set, so we can price the option of running
 *  the note writer on an API key instead of a personal subscription.
 *
 *    bun run src/scripts_jim/2026_11_03_nathan_claude_account/apiCost.ts */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const RUNNER_STOPPED = "2026-10-31T22:17:00Z";
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Run = { id: string; ended_at: string; tags: string[]; api_cost_usd: number | null };

const runs = await fetchAllRows<Run>(
  () => db.from("everything_claude_runs").select("id, ended_at, tags, api_cost_usd").lt("ended_at", RUNNER_STOPPED),
  "id",
  { label: "claude runs" },
);

function addCost(totals: Map<string, { runs: number; usd: number }>, key: string, run: Run) {
  const total = totals.get(key) ?? { runs: 0, usd: 0 };
  total.runs += 1;
  total.usd += Number(run.api_cost_usd ?? 0);
  totals.set(key, total);
}

const costByDay = new Map<string, { runs: number; usd: number }>();
const costByTags = new Map<string, { runs: number; usd: number }>();
for (const run of runs) {
  addCost(costByDay, run.ended_at.slice(0, 10), run);
  addCost(costByTags, [...run.tags].sort().join(","), run);
}

const formatRow = (key: string, total: { runs: number; usd: number }) =>
  `${key.padEnd(28)} ${String(total.runs).padStart(5)} runs  $${total.usd.toFixed(2).padStart(9)}`;

console.log("Per UTC day");
for (const [day, total] of [...costByDay].sort()) console.log(formatRow(day, total));
console.log("\nPer tag set");
for (const [tags, total] of [...costByTags].sort((a, b) => b[1].usd - a[1].usd)) console.log(formatRow(tags, total));

const totalUsd = runs.reduce((sum, run) => sum + Number(run.api_cost_usd ?? 0), 0);
const endedTimes = runs.map((run) => Date.parse(run.ended_at));
const spanDays = (Math.max(...endedTimes) - Math.min(...endedTimes)) / MS_PER_DAY;
console.log(`\nTotal: ${runs.length} runs, $${totalUsd.toFixed(2)} over ${spanDays.toFixed(1)} days`);
console.log(`Per week at that rate: $${((totalUsd / spanDays) * DAYS_PER_WEEK).toFixed(0)}`);
