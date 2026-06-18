/**
 * Smoke test: run the deepseek filter on a few dataset rows and print every
 * stage (queries, candidates, selected sources, full-page fetches, per-variant
 * verdicts) so we can eyeball that each step works before the full run.
 *
 *   SEARXNG_PROVIDERS=  bun run src/scripts_jim/2026_06_06_deepseek_note_filter/smoke.ts [n]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { runRowAllVariants, type DatasetRow } from "./pipeline";

async function main() {
  const n = process.argv[2] ? parseInt(process.argv[2], 10) : 4;
  const rows: DatasetRow[] = JSON.parse(readFileSync(join(import.meta.dir, "dataset.json"), "utf8"));
  const posts: { runId: string; post: Post }[] = JSON.parse(readFileSync(join(import.meta.dir, "posts.json"), "utf8"));
  const postByRun = new Map(posts.map((p) => [p.runId, p.post]));
  const wants = rows.filter((r) => r.label === "wants_note").slice(0, Math.ceil(n / 2));
  const no = rows.filter((r) => r.label === "no_note").slice(0, Math.floor(n / 2));

  for (const row of [...wants, ...no]) {
    console.log("\n========================================");
    console.log(`label=${row.label} (${row.outcome}/${row.outcomeReason})`);
    console.log(`tweet: ${(row.tweetText ?? "").slice(0, 140).replace(/\n/g, " ")}`);
    const t0 = Date.now();
    const results = await runRowAllVariants(row, postByRun.get(row.runId)!);
    const ms = Date.now() - t0;
    const r0 = results[0];
    console.log(`queries(${r0.queries.length}): ${r0.queries.join(" | ")}`);
    console.log(`fullInputChars=${r0.fullInputChars}  candidates=${r0.numCandidates}  selected=${results.find((r) => r.variant.startsWith("select"))?.numSelected}  fetched=${results.find((r) => r.variant.startsWith("select"))?.numFetched}  (${ms}ms)`);
    if (r0.error) console.log(`ERROR: ${r0.error}`);
    for (const r of results) {
      console.log(`  [${r.variant}] needsNote=${r.predNeedsNote}  $${r.costUsd?.toFixed(4)}`);
      console.log(`     ${r.predReason.slice(0, 200)}`);
    }
  }
}

main().then(() => process.exit(0));
