import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { csvRowToReviewItemInsert, type ReviewItemInsert } from "../dashboard-shared/reviewUpload";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { validateSignalDraft } from "../signal-bot/drafting";
import { parseReviewDraftBatchInput, type ReviewDraftBatchResult } from "./reviewDraftBatch";

const HELP = `Import a local draft batch into the review dashboard

Usage: bun src/local/uploadDraftReview.ts --input <results.json> --name <label> [options]

  --input <file>          results.json produced by reviewDraftBatch.ts
  --name <label>          Name for this review batch
  --dashboard-url <url>   Dashboard address (default: http://localhost:8001)
  --help, -h             Show help without calling any services

Uses standard SUPABASE_URL and SUPABASE_SERVICE_KEY environment/.env values.
Creates only review-dashboard upload and item records. Prints a review link;
does not open a browser, submit notes, or send Signal messages.
`;

interface UploadArgs {
  help: boolean;
  input?: string;
  name?: string;
  dashboardUrl: URL;
}

function parseArgs(args: string[]): UploadArgs {
  const parsed: UploadArgs = { help: args.includes("--help") || args.includes("-h"), dashboardUrl: new URL("http://localhost:8001") };
  if (parsed.help) return parsed;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1];
    if (!["--input", "--name", "--dashboard-url"].includes(flag) || seen.has(flag) || !value?.trim() || value.startsWith("--")) {
      throw new Error("Each option must appear once and have a value. Use --help for usage.");
    }
    seen.add(flag);
    if (flag === "--input") parsed.input = resolve(value);
    else if (flag === "--name") {
      if (value.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Use a batch name of at most 200 characters without control characters.");
      parsed.name = value.trim();
    } else {
      try { parsed.dashboardUrl = new URL(value); }
      catch { throw new Error("The dashboard URL must be a valid HTTP(S) URL."); }
      const url = parsed.dashboardUrl;
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("The dashboard URL must use HTTP(S), without credentials, query parameters, or a fragment.");
      }
    }
  }
  if (!parsed.input || !parsed.name) throw new Error("Provide --input and --name. Use --help for usage.");
  return parsed;
}

export function draftReviewRows(uploadId: string, manifest: unknown): ReviewItemInsert[] {
  const results = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? (manifest as { results?: unknown }).results : undefined;
  if (!Array.isArray(results) || !results.length) throw new Error("The input must contain a nonempty results array.");
  for (const report of results) {
    if (!report || typeof report !== "object" || !["draft", "no_draft", "error"].includes(report.status) ||
      typeof report.tweetId !== "string" || report.tweetId !== report.input?.post?.id) {
      throw new Error("Every result needs a valid status and a tweetId matching input.post.id.");
    }
  }
  parseReviewDraftBatchInput(results.map((report) => report.input));
  for (const report of results) {
    if (report.status !== "error" && (!report.result || typeof report.result.reply !== "string")) {
      throw new Error("Completed draft results need their drafting response.");
    }
    if (report.status === "draft") {
      try { validateSignalDraft(report.result?.draft); }
      catch { throw new Error("A draft result contains an invalid note or source URLs."); }
    } else if (report.result?.draft !== undefined) {
      throw new Error("A result with a draft must have status 'draft'.");
    }
  }
  return (results as ReviewDraftBatchResult[]).map((report) => {
    const draft = report.result?.draft;
    return csvRowToReviewItemInsert(uploadId, {
      url: `https://x.com/i/web/status/${report.input.post.id}`,
      text: report.input.post.text,
      bot_id: "simple-bot",
      note_text: draft ? joinNoteWithSources(draft.text, draft.sources) : undefined,
      note_status: draft ? "draft" : undefined,
      outcome: draft ? "draft_for_review" : report.status,
      result: "draft_review",
      failure_reason: report.status === "error" ? report.error : undefined,
      logs: { reviewDraftBatch: report },
    });
  });
}

interface UploadClient {
  createUpload(upload: { name: string; item_count: number }): Promise<string>;
  insertItems(rows: ReviewItemInsert[]): Promise<void>;
  deleteUpload(id: string): Promise<void>;
}

interface UploadDependencies {
  client?: UploadClient;
  log?: (text: string) => void;
  readInput?: (path: string) => Promise<string>;
}

async function defaultClient(): Promise<UploadClient> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing configuration");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key);
  return {
    async createUpload(upload) {
      const { data, error } = await client.from("review_dashboard_uploads").insert(upload).select("id").single();
      if (error) throw error;
      return data.id;
    },
    async insertItems(rows) {
      const { error } = await client.from("review_dashboard_items").insert(rows);
      if (error) throw error;
    },
    async deleteUpload(id) {
      // Migration 023 cascades deletion to this upload's review items.
      const { error } = await client.from("review_dashboard_uploads").delete().eq("id", id);
      if (error) throw error;
    },
  };
}

export async function runUploadDraftReview(args: string[], dependencies: UploadDependencies = {}): Promise<number> {
  const log = dependencies.log ?? console.log;
  let parsed: UploadArgs;
  try { parsed = parseArgs(args); }
  catch (error) { log((error as Error).message); return 1; }
  if (parsed.help) { log(HELP); return 0; }
  let raw: unknown;
  try { raw = JSON.parse(await (dependencies.readInput ?? ((path) => readFile(path, "utf8")))(parsed.input!)); }
  catch { log("Could not read the results JSON. Check its path, permissions, and JSON syntax."); return 1; }
  let rows: ReviewItemInsert[];
  try { rows = draftReviewRows("", raw); }
  catch { log("The results file is invalid. Each result needs valid input provenance, tweet data, status, and any produced draft."); return 1; }

  let client: UploadClient;
  try { client = dependencies.client ?? await defaultClient(); }
  catch { log("Could not configure Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_KEY."); return 1; }
  let uploadId: string;
  try {
    uploadId = await client.createUpload({ name: parsed.name!, item_count: rows.length });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId)) throw new Error("Invalid upload ID");
  } catch { log("Could not create the review upload. No review link was created."); return 1; }
  try {
    for (let offset = 0; offset < rows.length; offset += 50) {
      await client.insertItems(rows.slice(offset, offset + 50).map((row) => ({ ...row, upload_id: uploadId })));
    }
  } catch {
    try {
      await client.deleteUpload(uploadId);
      log("Import failed. The new upload and any items already imported were removed.");
    } catch {
      log(`Import failed and cleanup could not be completed. The incomplete review upload is ${uploadId}.`);
    }
    return 1;
  }
  parsed.dashboardUrl.searchParams.set("upload", uploadId);
  log(`Imported ${rows.length} results into the review dashboard: ${parsed.name}`);
  log(parsed.dashboardUrl.toString());
  return 0;
}

if (import.meta.main) process.exitCode = await runUploadDraftReview(process.argv.slice(2));
