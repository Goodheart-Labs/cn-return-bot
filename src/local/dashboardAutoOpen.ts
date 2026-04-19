/**
 * After a local pipeline run finishes, upload the results CSV to the prod
 * review-dashboard, make sure the dashboard server is up, and open the
 * freshly-uploaded run in a new browser tab.
 *
 * Works for parallel runs: each finish uploads its own row and opens its own
 * tab; the dashboard server is started at most once (EADDRINUSE is ignored).
 */

import { createClient } from "@supabase/supabase-js";
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { PROD_SUPABASE_URL, PROD_SUPABASE_SERVICE_KEY } from "./prodSupabaseCreds";
import { parseCsvRecords } from "../utils/csv";

const DASHBOARD_PORT = 8001;
const DASHBOARD_HOST = "127.0.0.1";
const PORT_PROBE_TIMEOUT_MS = 500;
const DASHBOARD_WAIT_ATTEMPTS = 40;
const DASHBOARD_WAIT_INTERVAL_MS = 250;
const BUILD_LOCK_POLL_MS = 500;
const BUILD_LOCK_MAX_WAIT_MS = 120_000;

const BUILD_LOCK_DIR = path.join(process.cwd(), "dataset_runs", ".dashboard-build.lock");
const DIST_INDEX = path.join(process.cwd(), "src/review-dashboard/dist/index.html");

function isPortListening(port: number, host: string, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(port, host);
  });
}

async function waitForPort(port: number, host: string): Promise<boolean> {
  for (let i = 0; i < DASHBOARD_WAIT_ATTEMPTS; i++) {
    if (await isPortListening(port, host)) return true;
    await new Promise((r) => setTimeout(r, DASHBOARD_WAIT_INTERVAL_MS));
  }
  return false;
}

// Atomic lockfile-based mutex: mkdirSync(lockDir) is atomic on POSIX, so the
// first parallel finisher wins and runs `vite build`; the others wait for
// dist/index.html to appear. Prevents concurrent builds from corrupting dist/.
async function ensureDashboardBuilt(): Promise<void> {
  if (fs.existsSync(DIST_INDEX)) return;

  fs.mkdirSync(path.dirname(BUILD_LOCK_DIR), { recursive: true });
  let haveLock = false;
  try {
    fs.mkdirSync(BUILD_LOCK_DIR);
    haveLock = true;
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err;
  }

  if (haveLock) {
    try {
      console.log("[dashboard] dist/ missing — building (first run only)...");
      execSync("bun run build-review", { cwd: process.cwd(), stdio: "inherit" });
    } finally {
      try { fs.rmdirSync(BUILD_LOCK_DIR); } catch {}
    }
    return;
  }

  console.log("[dashboard] another process is building dist/ — waiting...");
  const deadline = Date.now() + BUILD_LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(DIST_INDEX) && !fs.existsSync(BUILD_LOCK_DIR)) return;
    await new Promise((r) => setTimeout(r, BUILD_LOCK_POLL_MS));
  }
  throw new Error(`dashboard build did not finish within ${BUILD_LOCK_MAX_WAIT_MS}ms`);
}

async function ensureDashboardRunning(): Promise<void> {
  if (await isPortListening(DASHBOARD_PORT, DASHBOARD_HOST)) return;

  await ensureDashboardBuilt();

  const logPath = path.join(process.cwd(), "dataset_runs", "dashboard.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");

  // The pipeline process remapped SUPABASE_URL/KEY to local; the dashboard server
  // must inject PROD creds into the page or the browser queries the wrong DB.
  const childEnv = { ...process.env };
  if (PROD_SUPABASE_URL) childEnv.SUPABASE_URL = PROD_SUPABASE_URL;
  if (PROD_SUPABASE_SERVICE_KEY) childEnv.SUPABASE_SERVICE_KEY = PROD_SUPABASE_SERVICE_KEY;

  console.log(`[dashboard] starting server at http://localhost:${DASHBOARD_PORT} (log: ${logPath})`);
  const child = spawn("bun", ["run", "serve-review"], {
    cwd: process.cwd(),
    env: childEnv,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const up = await waitForPort(DASHBOARD_PORT, DASHBOARD_HOST);
  if (!up) throw new Error(`dashboard did not come up on port ${DASHBOARD_PORT}`);
}

function readCsvRows(csvPath: string): Record<string, string>[] {
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const records = parseCsvRecords(content);
  if (records.length < 2) return [];
  const header = records[0]!;
  return records.slice(1).map((fields) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = fields[i] ?? "";
    });
    return row;
  });
}

async function uploadCsvToProdDashboard(csvPath: string, name: string): Promise<string> {
  if (!PROD_SUPABASE_URL || !PROD_SUPABASE_SERVICE_KEY) {
    throw new Error("PROD_SUPABASE_URL/SERVICE_KEY missing (prodSupabaseCreds must import before remap)");
  }
  const client = createClient(PROD_SUPABASE_URL, PROD_SUPABASE_SERVICE_KEY);
  const rows = readCsvRows(csvPath);
  if (rows.length === 0) throw new Error(`no rows in ${csvPath}`);

  const { data: upload, error: uploadErr } = await client
    .from("review_dashboard_uploads")
    .insert({ name, item_count: rows.length })
    .select("id")
    .single();
  if (uploadErr) throw uploadErr;

  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      upload_id: upload.id,
      url: r.url ?? "",
      tweet_text: r.text || null,
      needs_note: r.needs_note || null,
      ground_truth_note: r.ground_truth_note || null,
      bot_id: r.bot_id || null,
      note_status: r.note_status || null,
      outcome: r.outcome || null,
      result: r.result || null,
      note_text: r.note_text || null,
      source_verification: r.source_verification || null,
      evaluation_score: r.evaluation_score ? Number(r.evaluation_score) : null,
      logs: r.logs ? safeParseJson(r.logs) : null,
    }));
    const { error } = await client.from("review_dashboard_items").insert(chunk);
    if (error) throw error;
  }

  return upload.id as string;
}

function safeParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

function openUrlInBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch (err: any) {
    console.warn(`[dashboard] could not open browser: ${err?.message}`);
  }
}

export async function autoOpenInDashboard(csvPath: string, runName: string): Promise<void> {
  try {
    const uploadId = await uploadCsvToProdDashboard(csvPath, runName);
    console.log(`[dashboard] uploaded ${runName} → ${uploadId}`);
    await ensureDashboardRunning();
    const url = `http://localhost:${DASHBOARD_PORT}/?upload=${uploadId}`;
    console.log(`[dashboard] opening ${url}`);
    openUrlInBrowser(url);
  } catch (err: any) {
    console.error(`[dashboard] auto-open failed: ${err?.message}`);
  }
}
