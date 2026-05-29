/**
 * Re-run ONLY the eval judge (categorizeRowV2) over an already-completed run CSV,
 * applying the new 3-tier verdict + nw_published_directional / nnw_fp_harmless
 * buckets. Does NOT re-run the bot pipeline — it re-judges the notes that were
 * already written (the CSV carries `logs`, so stage_block + proposed note are
 * recoverable). Writes a fresh run folder and auto-opens it in the dashboard.
 *
 * CRITICAL: the eval judge reads judge_guidance/needs_note/etc. FROM THE ROW. A
 * run CSV bakes in the guidance that was in the valset when the bot ran, so
 * re-judging the CSV alone silently uses STALE guidance — valset corrections made
 * after the run never take effect. We therefore refresh the ground-truth columns
 * from the current valset (by tweet id) before judging, making the valset the
 * single source of truth for what a correct note must do.
 *
 * Usage: bun run src/scripts_jim/2026_05_29_rejudge_tiers/rejudge.ts <results.csv> [runName] [valset.csv]
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords, escapeCsvField } from "../../utils/csv";
import {
  categorizeRowV2,
  writeResultJsonsV2,
  type CsvRow,
  type CategorizedRowV2,
} from "../../local/evaluateResults";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";
import { autoOpenInDashboard } from "../../local/dashboardAutoOpen";

const CONCURRENCY = 8;
const DEFAULT_VALSET = "datasets/big_eval/splits/val.csv";

// Ground-truth columns owned by the valset, refreshed onto each run row before
// judging so post-run guidance corrections take effect.
const GROUND_TRUTH_COLUMNS = [
  "needs_note",
  "ground_truth_note",
  "judge_guidance",
  "original_note_text",
  "failure_reason",
] as const;

function tweetIdFromUrl(url: string | undefined): string | null {
  return url?.match(/status\/(\d+)/)?.[1] ?? null;
}

function loadCsv(csvPath: string): { headers: string[]; rows: CsvRow[] } {
  const records = parseCsvRecords(fs.readFileSync(csvPath, "utf8").trim());
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((fields) => {
    const row: CsvRow = {};
    headers.forEach((h, i) => (row[h] = fields[i] ?? ""));
    return row;
  });
  return { headers, rows };
}

/** Map tweet id → current ground-truth columns from the valset. */
function loadValsetGuidance(valsetPath: string): Map<string, Partial<CsvRow>> {
  const { rows } = loadCsv(valsetPath);
  const map = new Map<string, Partial<CsvRow>>();
  for (const row of rows) {
    const id = tweetIdFromUrl(row.url);
    if (!id) continue;
    const entry: Partial<CsvRow> = {};
    for (const col of GROUND_TRUTH_COLUMNS) if (col in row) entry[col] = row[col];
    map.set(id, entry);
  }
  return map;
}

/** Overwrite each run row's ground-truth columns from the valset (by tweet id).
 *  Returns counts so we can see how many rows were refreshed / had a real change. */
function refreshGuidanceFromValset(rows: CsvRow[], valset: Map<string, Partial<CsvRow>>): { refreshed: number; changed: number; missing: number } {
  let refreshed = 0, changed = 0, missing = 0;
  for (const row of rows) {
    const id = tweetIdFromUrl(row.url);
    const gt = id ? valset.get(id) : undefined;
    if (!gt) { missing++; continue; }
    refreshed++;
    let rowChanged = false;
    for (const col of GROUND_TRUTH_COLUMNS) {
      if (gt[col] === undefined) continue;
      if ((row[col] ?? "") !== gt[col]) rowChanged = true;
      row[col] = gt[col]!;
    }
    if (rowChanged) changed++;
  }
  return { refreshed, changed, missing };
}

function writeCsv(outPath: string, headers: string[], rows: CsvRow[]): void {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) lines.push(headers.map((h) => escapeCsvField(row[h] ?? "")).join(","));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  captureProdSupabaseCreds();
  const csvPath = process.argv[2];
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error("Usage: bun run .../rejudge.ts <results.csv> [runName]");
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const runName = process.argv[3] ?? `rejudge-tiers-${stamp}`;
  const valsetPath = process.argv[4] ?? DEFAULT_VALSET;

  const { headers, rows } = loadCsv(csvPath);
  console.log(`[rejudge] loaded ${rows.length} rows from ${csvPath}`);
  if (!headers.includes("result")) headers.push("result");

  if (fs.existsSync(valsetPath)) {
    const valset = loadValsetGuidance(valsetPath);
    const { refreshed, changed, missing } = refreshGuidanceFromValset(rows, valset);
    console.log(`[rejudge] refreshed ground-truth from ${valsetPath}: ${refreshed} matched (${changed} with changed guidance), ${missing} not in valset`);
  } else {
    console.warn(`[rejudge] valset ${valsetPath} not found — judging with guidance baked into the run CSV (may be stale)`);
  }

  let done = 0;
  const categorized: CategorizedRowV2[] = await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    const c = await categorizeRowV2(row);
    row.result = c.category;
    done++;
    if (done % 10 === 0 || done === rows.length) console.log(`[rejudge] ${done}/${rows.length}`);
    return c;
  });

  const outDir = path.join(process.cwd(), "dataset_runs", runName);
  fs.mkdirSync(outDir, { recursive: true });
  const outCsv = path.join(outDir, `results_${runName}.csv`);
  writeCsv(outCsv, headers, rows);
  const counts = writeResultJsonsV2(categorized, outDir);

  console.log("\n[rejudge] new category counts:");
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k.padEnd(30)} ${v}`);

  await autoOpenInDashboard(outCsv, runName);
  console.log(`\n[rejudge] done → ${outCsv}`);
}

main().catch((e) => {
  console.error("[rejudge] fatal:", e);
  process.exit(1);
});
