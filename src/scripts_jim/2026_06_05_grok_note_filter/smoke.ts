/**
 * Smoke test: run the Grok filter on a few dataset rows (both versions) and
 * print full results, so we can confirm Grok fetches the post, searches, and
 * returns parseable JSON before the expensive full run.
 *
 *   bun run src/scripts_jim/2026_06_05_grok_note_filter/smoke.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { grokNeedsNote, type PromptVersion } from "./filter";
import type { DatasetRow } from "./buildDataset";

async function main() {
  const rows: DatasetRow[] = JSON.parse(
    readFileSync(join(import.meta.dir, "dataset.json"), "utf8"),
  );
  const wants = rows.filter((r) => r.label === "wants_note").slice(0, 2);
  const no = rows.filter((r) => r.label === "no_note").slice(0, 2);
  const sample = [...wants, ...no];

  for (const row of sample) {
    console.log("\n========================================");
    console.log(`label=${row.label} (${row.outcome}/${row.outcomeReason})`);
    console.log(`url: ${row.tweetUrl}`);
    console.log(`tweet: ${(row.tweetText ?? "").slice(0, 160).replace(/\n/g, " ")}`);
    for (const version of ["neutral", "lenient"] as PromptVersion[]) {
      const t0 = Date.now();
      const res = await grokNeedsNote(row.tweetUrl, version);
      const ms = Date.now() - t0;
      console.log(`  [${version}] needsNote=${res.needsNote} ` +
        `sources=${res.numSourcesUsed} tok=${res.inputTokens}/${res.outputTokens} ${ms}ms` +
        (res.error ? ` ERROR=${res.error}` : ""));
      console.log(`     reason: ${res.reason.slice(0, 220)}`);
      console.log(`     citations: ${res.citations.slice(0, 3).join(" | ")}`);
    }
  }
}

main().then(() => process.exit(0));
