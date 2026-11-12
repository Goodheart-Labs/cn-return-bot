/* How many dollars of API-equivalent cost one percent of a Claude plan's weekly
 * usage buys. Read-only.
 *
 * It compares, in one time window, the rise of the plan's weekly usage with
 * what Claude Code says the runs in that window would have cost on the API. A
 * run that only partly overlaps the window counts with the overlapping part of
 * its cost. Only the runner on ai-box ran on Nathan's plan and recorded every
 * run's cost. Its run folders are under /tmp or /var/tmp. Since 1 Nov the
 * devbox session runs the jobs on Jim's plan, and most of its runs have no cost.
 *
 * The default window is the only clean one: from the first recorded cost on
 * 29 Oct to the last usage reading before Nathan's account was put on hold on
 * 31 Oct at 22:17.
 *
 *   bun run src/scripts_jim/2026_11_02_gpt_experiment_1/claudeCostPerPercent.ts [from] [to] */

import { db } from "../../claude-notes/store";
import { fetchAllRows } from "../../everything-core/paging";

const [from = "2026-10-29T08:00:00Z", to = "2026-10-31T22:02:00Z"] = process.argv.slice(2);
const DAY_MS = 24 * 3600_000;
const AI_BOX_RUN_FOLDER = /^\/(var\/)?tmp\//;

const usage = await fetchAllRows<{ id: number; at: string; weekly: number }>(
  () => db().from("everything_claude_usage").select("id, at, weekly").gte("at", new Date(Date.parse(from) - DAY_MS).toISOString()).lte("at", to),
  "id",
  { label: "usage" },
);
const runs = (
  await fetchAllRows<{ id: string; started_at: string; ended_at: string; api_cost_usd: number | null; run_dir: string }>(
    () => db().from("everything_claude_runs").select("id, started_at, ended_at, api_cost_usd, run_dir").gte("ended_at", from),
    "id",
    { label: "runs" },
  )
).filter((run) => AI_BOX_RUN_FOLDER.test(run.run_dir));

/** The last usage reading at or before the moment. */
function weeklyAt(moment: number): number {
  const before = usage.filter((reading) => Date.parse(reading.at) <= moment);
  return before.reduce((latest, reading) => (reading.at > latest.at ? reading : latest)).weekly;
}

function costBetween(start: number, end: number): number {
  return runs.reduce((sum, run) => {
    const runStart = Date.parse(run.started_at);
    const runEnd = Date.parse(run.ended_at);
    const overlap = Math.min(runEnd, end) - Math.max(runStart, start);
    return overlap > 0 ? sum + (Number(run.api_cost_usd ?? 0) * overlap) / Math.max(runEnd - runStart, 1) : sum;
  }, 0);
}

function report(label: string, start: number, end: number) {
  const rise = weeklyAt(end) - weeklyAt(start);
  const cost = costBetween(start, end);
  const perPercent = rise > 0 ? `$${(cost / rise).toFixed(2)} per percent` : "no rise";
  console.log(`${label}: weekly usage ${weeklyAt(start)}% to ${weeklyAt(end)}%, runs cost $${cost.toFixed(0)}, ${perPercent}`);
}

const start = Date.parse(from);
const end = Date.parse(to);
console.log(`${runs.length} ai-box runs, ${runs.filter((run) => run.api_cost_usd === null).length} of them without a cost`);
report("Whole window", start, end);
for (let dayStart = start; dayStart < end; dayStart += DAY_MS) {
  report(`  from ${new Date(dayStart).toISOString().slice(0, 16)}`, dayStart, Math.min(dayStart + DAY_MS, end));
}
