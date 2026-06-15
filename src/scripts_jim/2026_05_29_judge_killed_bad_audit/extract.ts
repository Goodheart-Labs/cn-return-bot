/**
 * Extract nw_miss_judge_killed_bad rows from a run CSV for independent Sonnet
 * audit. For each such row, dump the post, the writer's PROPOSED note (the one
 * the eval judge rated "bad"), its sources, plus the valset ground truth /
 * guidance for reference. Writes one JSON array → rows.json.
 *
 * Usage: bun run src/scripts_jim/2026_05_29_judge_killed_bad_audit/extract.ts [results.csv]
 */
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { extractProposedNote, type CsvRow } from "../../local/evaluateResults";

const DEFAULT_CSV =
  "dataset_runs/iter07-satire-plus-guidance/results_iter07-satire-plus-guidance.csv";
const TARGET = "nw_miss_judge_killed_bad";

function tweetIdFromUrl(url: string | undefined): string | null {
  return url?.match(/status\/(\d+)/)?.[1] ?? null;
}

function loadCsv(csvPath: string): CsvRow[] {
  const records = parseCsvRecords(fs.readFileSync(csvPath, "utf8").trim());
  const headers = records[0]!.map((h) => h.trim());
  return records.slice(1).map((fields) => {
    const row: CsvRow = {};
    headers.forEach((h, i) => (row[h] = fields[i] ?? ""));
    return row;
  });
}

function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  const rows = loadCsv(csvPath);
  const target = rows.filter((r) => (r.result ?? "").trim() === TARGET);
  console.log(`[extract] ${target.length} ${TARGET} rows of ${rows.length} total`);

  const out = target.map((r) => {
    let logsObj: any = null;
    try {
      logsObj = JSON.parse(r.logs ?? "{}");
    } catch {}
    const proposed = extractProposedNote(logsObj);
    return {
      tweet_id: tweetIdFromUrl(r.url),
      url: r.url,
      post_text: r.text,
      proposed_note_text: proposed?.noteText ?? null,
      proposed_note_sources: proposed?.sources ?? [],
      ground_truth_note: r.ground_truth_note,
      judge_guidance: r.judge_guidance,
      failure_reason: r.failure_reason,
      original_note_text: r.original_note_text,
    };
  });

  const outDir = path.dirname(new URL(import.meta.url).pathname);
  const outPath = path.join(outDir, "rows.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`[extract] wrote ${out.length} rows → ${outPath}`);
  for (const r of out) {
    console.log(`  ${r.tweet_id}  proposed_note_len=${(r.proposed_note_text ?? "").length}  sources=${r.proposed_note_sources.length}`);
  }
}

main();
