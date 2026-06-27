/**
 * Manually upload dataset-run result CSVs to the prod review dashboard and open
 * each in Chrome. Recovery tool for when the in-pipeline auto-open failed (e.g.
 * prod Supabase was briefly unreachable). The dashboard server must already be
 * running on :8001 (`bun run review`).
 *
 * Args: one or more CSV paths or dataset_runs folders (latest results_*.csv is
 * used). With no args, defaults to the latest of the three liked reruns.
 *
 *   bun run src/scripts_jim/2026_06_26_upload_results/upload_and_open.ts
 *   bun run src/scripts_jim/2026_06_26_upload_results/upload_and_open.ts dataset_runs/youtube-claims-liked_jensen_huang_rerun-2026-06-26-1438
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";
import { csvRowToReviewItemInsert } from "../../dashboard-shared/reviewUpload";

const DASHBOARD_URL = "http://localhost:8001";
const UPLOAD_CHUNK = 50;

const DEFAULT_RUN_PREFIXES = [
  "dataset_runs/youtube-claims-liked_jensen_huang_rerun-",
  "dataset_runs/youtube-claims-liked_michael_nielson_rerun-",
  "dataset_runs/youtube-claims-liked_phil_trammel_rerun-",
];

/** Latest dataset_runs folder whose name starts with `prefix`. */
function latestRunFolder(prefix: string): string | null {
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir).filter((d) => d.startsWith(base)).sort();
  return matches.length ? path.join(dir, matches[matches.length - 1]!) : null;
}

/** Resolve a CLI arg (a CSV path or a run folder) to its results CSV. */
function resolveCsv(arg: string): string {
  if (arg.endsWith(".csv")) return arg;
  const csv = fs.readdirSync(arg).find((f) => f.startsWith("results_") && f.endsWith(".csv"));
  if (!csv) throw new Error(`no results_*.csv in ${arg}`);
  return path.join(arg, csv);
}

function readCsvRows(csvPath: string): Record<string, string>[] {
  const records = parseCsvRecords(fs.readFileSync(csvPath, "utf8").trim());
  if (records.length < 2) return [];
  const header = records[0]!;
  return records.slice(1).map((fields) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = fields[i] ?? ""));
    return row;
  });
}

async function uploadCsv(client: ReturnType<typeof createClient>, csvPath: string, name: string): Promise<string> {
  const rows = readCsvRows(csvPath);
  if (rows.length === 0) throw new Error(`no rows in ${csvPath}`);

  const { data: upload, error: upErr } = await client
    .from("review_dashboard_uploads")
    .insert({ name, item_count: rows.length })
    .select("id")
    .single();
  if (upErr) throw upErr;
  const uploadId = (upload as { id: string }).id;

  for (let i = 0; i < rows.length; i += UPLOAD_CHUNK) {
    const chunk = rows.slice(i, i + UPLOAD_CHUNK).map((r) => csvRowToReviewItemInsert(uploadId, r));
    const { error } = await client.from("review_dashboard_items").insert(chunk);
    if (error) throw error;
  }
  return uploadId;
}

function openInChrome(url: string): void {
  spawn("open", ["-a", "Google Chrome", url], { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (need prod creds from .env)");
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    throw new Error(`SUPABASE_URL points at local (${url}); the dashboard reads prod. Run without the local remap.`);
  }
  const client = createClient(url, key);

  const args = process.argv.slice(2);
  const targets = args.length
    ? args.map(resolveCsv)
    : DEFAULT_RUN_PREFIXES.map(latestRunFolder).filter((f): f is string => f !== null).map(resolveCsv);

  if (targets.length === 0) throw new Error("no result CSVs found to upload");

  for (const csvPath of targets) {
    const name = path.basename(path.dirname(csvPath)).replace(/^youtube-claims-/, "");
    const id = await uploadCsv(client, csvPath, name);
    const viewUrl = `${DASHBOARD_URL}/?upload=${id}`;
    console.log(`✅ ${name} → ${id}\n   ${viewUrl}`);
    openInChrome(viewUrl);
  }
}

main().catch((err) => {
  console.error("upload failed:", err?.message ?? err?.title ?? JSON.stringify(err)?.slice(0, 400));
  process.exit(1);
});
