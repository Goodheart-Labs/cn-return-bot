/**
 * Run On Videos
 *
 * Run the pipeline on videos from any platform (X, YouTube, TikTok, etc.)
 * using yt-dlp for metadata extraction. No X API credentials needed.
 *
 * Input: CSV file with columns:
 *   - url (required): link to the video/post
 *   - needs_note (optional): ground truth label ("yes" or "no")
 *   - ground_truth_note (optional): what the note should say
 *
 * Usage:
 *   bun run src/scripts/runOnVideos.ts input.csv
 *   bun run src/scripts/runOnVideos.ts https://x.com/... https://youtube.com/...
 */

import "dotenv/config";

// Route Supabase to local instance (must happen before any Supabase imports)
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import { SupabaseLogger } from "../api/supabaseClient";
import { selectRandomBot, getBotById, getEnabledBots } from "../bots";
import { processSingleTweet, type ProcessTweetResult } from "../pipeline/processTweet";
import { closeBrowser } from "../pipeline/browserManager";
import { createTweetLog, withTweetLog } from "../pipeline/tweetLog";
import type { Post } from "../api/fetchEligiblePosts";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import PQueue from "p-queue";
import { parseCsvRecords, escapeCsvField } from "../utils/csv";
import {
  categorizeRow,
  writeResultJsons,
  type CsvRow,
  type CategorizedRow,
  type Category,
  type BucketCounts,
} from "./evaluateResults";

const concurrencyLimit = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InputRow {
  url: string;
  needsNote?: string;
  groundTruthNote?: string;
}

interface YtDlpMetadata {
  id: string;
  title: string;
  description?: string;
  url?: string;
  formats?: Array<{
    url: string;
    ext: string;
    vcodec?: string;
    acodec?: string;
    width?: number;
    height?: number;
    tbr?: number;
  }>;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  uploader_id?: string;
  webpage_url?: string;
  ext?: string;
  filename?: string;
  _filename?: string;
  display_id?: string;
}

// ---------------------------------------------------------------------------
// CSV parsing (input)
// ---------------------------------------------------------------------------

function parseInputCsv(filePath: string): InputRow[] {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const records = parseCsvRecords(content);

  if (records.length < 2) {
    console.error("CSV must have a header row and at least one data row");
    process.exit(1);
  }

  const header = records[0]!.map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf("url");
  if (urlIdx === -1) {
    console.error('CSV must have a "url" column');
    process.exit(1);
  }

  const needsNoteIdx = header.indexOf("needs_note");
  const groundTruthIdx = header.indexOf("ground_truth_note");

  const rows: InputRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const url = fields[urlIdx]?.trim();
    if (!url) continue;

    rows.push({
      url,
      needsNote: needsNoteIdx >= 0 ? fields[needsNoteIdx]?.trim() : undefined,
      groundTruthNote: groundTruthIdx >= 0 ? fields[groundTruthIdx]?.trim() : undefined,
    });
  }

  return rows;
}


// ---------------------------------------------------------------------------
// yt-dlp metadata extraction
// ---------------------------------------------------------------------------

function extractIdFromUrl(url: string): string {
  // X/Twitter: extract tweet ID
  const tweetMatch = url.match(/status\/(\d+)/);
  if (tweetMatch) return tweetMatch[1]!;

  // YouTube: extract video ID
  const ytMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return ytMatch[1]!;

  // Fallback: hash the URL
  let hash = 0;
  for (const ch of url) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString();
}

interface DownloadResult {
  meta: YtDlpMetadata;
  videoPath: string | null;
}

function downloadWithYtDlp(url: string, outputDir: string): DownloadResult {
  const videoOutput = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    // yt-dlp prints JSON to stdout; download happens as side effect.
    // --print after_move:filepath gives the final file path on a separate line.
    const output = execSync(
      `yt-dlp -J -o "${videoOutput}" "${url}"`,
      { timeout: 120_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const meta: YtDlpMetadata = JSON.parse(output);

    // Now download separately (--dump-json doesn't always download reliably)
    execSync(
      `yt-dlp -o "${videoOutput}" "${url}"`,
      { timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] }
    );

    // Use filename from metadata, or search the output directory
    const expectedPath = meta.filename ?? meta._filename ?? path.join(outputDir, `${meta.id}.${meta.ext ?? "mp4"}`);
    const videoPath = fs.existsSync(expectedPath) ? expectedPath : null;

    return { meta, videoPath };
  } catch (err: any) {
    throw new Error(`yt-dlp failed for ${url}: ${err?.message}`);
  }
}

function buildPostFromDownload(meta: YtDlpMetadata, videoPath: string | null, url: string): Post {
  const text = [meta.title, meta.description].filter(Boolean).join("\n\n");

  const media: Post["media"] = [];
  if (videoPath) {
    media.push({
      type: "video",
      url: videoPath,
      duration_ms: meta.duration ? meta.duration * 1000 : undefined,
      variants: [{ url: videoPath, content_type: "video/mp4" }],
    });
  } else if (meta.thumbnail) {
    media.push({
      type: "photo",
      url: meta.thumbnail,
    });
  }

  // Prefer display_id (tweet ID) over id (video asset ID)
  const postId = meta.display_id ?? extractIdFromUrl(url);

  return {
    id: postId,
    author_id: meta.uploader_id ?? "unknown",
    created_at: new Date().toISOString(),
    text,
    media,
  };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

const OUTPUT_HEADERS = [
  "url",
  "text",
  "needs_note",
  "ground_truth_note",
  "bot_id",
  "note_status",
  "outcome",
  "note_text",
  "source_verification",
  "evaluation_score",
  "logs",
] as const;


function resultToCsvRow(
  input: InputRow,
  botId: string,
  result: ProcessTweetResult,
  log?: Map<string, unknown>
): string {
  const pr = result.pipelineResult;
  const svScore = result.scores.find((s) => s.type === "source_verification");

  const fields: Record<(typeof OUTPUT_HEADERS)[number], string> = {
    url: input.url,
    text: pr?.post?.text ?? "",
    needs_note: input.needsNote ?? "",
    ground_truth_note: input.groundTruthNote ?? "",
    bot_id: botId,
    note_status: result.noteStatus ?? "",
    outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
    note_text: result.noteText ?? "",
    source_verification: svScore?.label ?? (svScore ? String(svScore.value) : "skipped"),
    evaluation_score: result.evaluationScore?.toFixed(2) ?? "",
    logs: log ? JSON.stringify(Object.fromEntries(log)) : "",
  };

  return OUTPUT_HEADERS.map((h) => escapeCsvField(fields[h])).join(",");
}

function errorToCsvRow(input: InputRow, errorMsg: string): string {
  return OUTPUT_HEADERS.map((h) =>
    escapeCsvField(
      h === "url" ? input.url :
        h === "needs_note" ? (input.needsNote ?? "") :
          h === "ground_truth_note" ? (input.groundTruthNote ?? "") :
            h === "outcome" ? `error: ${errorMsg}` : ""
    )
  ).join(",");
}

function initOutputFolder(): { folderPath: string; csvPath: string; appendRow: (row: string) => void } {
  const baseDir = path.join(process.cwd(), "tryout-results");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const folderPath = path.join(baseDir, `videos-${timestamp}`);
  fs.mkdirSync(folderPath, { recursive: true });

  const csvPath = path.join(folderPath, "results.csv");
  fs.writeFileSync(csvPath, OUTPUT_HEADERS.join(",") + "\n", "utf8");

  return {
    folderPath,
    csvPath,
    appendRow: (row: string) => fs.appendFileSync(csvPath, row + "\n", "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Category, { emoji: string; label: string }> = {
  note_worthy_correct: { emoji: "✅", label: "correct" },
  note_worthy_incorrect: { emoji: "❌", label: "incorrect" },
  note_worthy_not_proposed: { emoji: "❌", label: "missed" },
  non_note_worthy_correct: { emoji: "✅", label: "correct" },
  non_note_worthy_incorrect: { emoji: "❌", label: "false positive" },
};

interface CompletedResult {
  idx: number;
  url: string;
  title: string;
  outcome: string;
  outcomeReason?: string;
  noteText?: string;
  categorized?: CategorizedRow | null;
}

function formatResult(r: CompletedResult, count: number, total: number): string {
  const reason = r.outcomeReason ? ` (${r.outcomeReason})` : "";
  const lines: string[] = [];

  if (r.categorized) {
    const { emoji, label } = CATEGORY_LABELS[r.categorized.category];
    lines.push(`--- ${count}/${total} ---`);
    lines.push(`${emoji} (${label}) | ${r.outcome}${reason}`);
  } else {
    lines.push(`--- ${count}/${total} ---`);
    lines.push(`${r.outcome}${reason}`);
  }

  lines.push(`  ${r.url}`);
  lines.push(`  ${r.title}`);
  if (r.noteText) {
    lines.push(`  note: ${r.noteText.slice(0, 120)}`);
  }
  return lines.join("\n");
}

function fmtRate(count: number, total: number): string {
  if (total === 0) return "—";
  return `${count}/${total} (${((count / total) * 100).toFixed(0)}%)`;
}

function printSummary(counts: BucketCounts, totalProcessed: number, errors: number, outputPath: string) {
  const nwTotal = counts.note_worthy_correct + counts.note_worthy_incorrect + counts.note_worthy_not_proposed;
  const nnwTotal = counts.non_note_worthy_correct + counts.non_note_worthy_incorrect;
  const scoredTotal = nwTotal + nnwTotal;
  const overallCorrect = counts.note_worthy_correct + counts.non_note_worthy_correct;
  const skipped = totalProcessed - scoredTotal - errors;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS: ${totalProcessed} processed, ${errors} errors`);
  console.log(`Output: ${outputPath}`);

  if (nwTotal > 0) {
    console.log(`\n  NOTEWORTHY (ground truth = yes): ${nwTotal} tweets`);
    console.log(`    correct:      ${fmtRate(counts.note_worthy_correct, nwTotal).padEnd(16)} AI judge confirmed note is good`);
    console.log(`    incorrect:    ${fmtRate(counts.note_worthy_incorrect, nwTotal).padEnd(16)} note proposed but wrong`);
    console.log(`    not proposed: ${fmtRate(counts.note_worthy_not_proposed, nwTotal).padEnd(16)} missed entirely`);
  }

  if (nnwTotal > 0) {
    console.log(`\n  NON-NOTEWORTHY (ground truth = no): ${nnwTotal} tweets`);
    console.log(`    correct:      ${fmtRate(counts.non_note_worthy_correct, nnwTotal).padEnd(16)} correctly no note`);
    console.log(`    incorrect:    ${fmtRate(counts.non_note_worthy_incorrect, nnwTotal).padEnd(16)} false positive`);
  }

  if (scoredTotal > 0) {
    console.log(`\n  OVERALL: ${fmtRate(overallCorrect, scoredTotal)}`);
  }
  if (skipped > 0) {
    console.log(`  NO GROUND TRUTH: ${skipped} skipped`);
  }
  console.log("=".repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run src/scripts/runOnVideos.ts [--bot <bot-id>] <input.csv>");
    console.error("       bun run src/scripts/runOnVideos.ts [--bot <bot-id>] <url1> <url2> ...");
    console.error("\nAvailable bots:", getEnabledBots().map((b) => b.id).join(", "));
    process.exit(1);
  }

  // Parse --bot flag
  let forcedBotId: string | undefined;
  const botFlagIdx = args.indexOf("--bot");
  if (botFlagIdx !== -1) {
    forcedBotId = args[botFlagIdx + 1];
    if (!forcedBotId) {
      console.error("--bot requires a bot ID");
      process.exit(1);
    }
    if (!getBotById(forcedBotId)) {
      console.error(`Unknown bot: ${forcedBotId}`);
      console.error("Available bots:", getEnabledBots().map((b) => b.id).join(", "));
      process.exit(1);
    }
    args.splice(botFlagIdx, 2);
  }

  // Verify yt-dlp is installed
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }

  // Determine if args are URLs or a CSV file
  const isUrls = args.every((a) => a.startsWith("http://") || a.startsWith("https://"));
  let inputs: InputRow[];

  if (isUrls) {
    inputs = args.map((url) => ({ url }));
    console.log(`[runOnVideos] Processing ${inputs.length} URL(s) from command line`);
  } else if (args.length === 1 && fs.existsSync(args[0]!)) {
    inputs = parseInputCsv(args[0]!);
    console.log(`[runOnVideos] Loaded ${inputs.length} row(s) from ${args[0]}`);
  } else {
    console.error(`File not found: ${args[0]}`);
    process.exit(1);
  }

  // Initialize logger (optional)
  let logger: SupabaseLogger | null = null;
  try {
    logger = new SupabaseLogger();
    console.log(`[runOnVideos] Connected to Supabase at ${process.env.SUPABASE_URL}`);
  } catch {
    console.log("[runOnVideos] No Supabase configured — running without DB logging");
  }

  // Create temp directory for downloaded videos
  const downloadDir = path.join(tmpdir(), `cn-runOnVideos-${Date.now()}`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const output = initOutputFolder();
  console.log(`[runOnVideos] Output folder: ${output.folderPath}`);
  const results: CompletedResult[] = [];
  const categorizedRows: CategorizedRow[] = [];
  let completedCount = 0;
  let errorCount = 0;

  const queue = new PQueue({ concurrency: concurrencyLimit });

  for (const [idx, input] of inputs.entries()) {
    queue.add(async () => {
      const completed: CompletedResult = {
        idx,
        url: input.url,
        title: "",
        outcome: "error",
      };

      let csvRowData: CsvRow | null = null;

      try {
        const { meta, videoPath } = downloadWithYtDlp(input.url, downloadDir);
        completed.title = meta.title?.slice(0, 80) ?? "";

        const post = buildPostFromDownload(meta, videoPath, input.url);
        const bot = forcedBotId ? getBotById(forcedBotId)! : selectRandomBot();
        const log = createTweetLog();
        log.set("tweet.index", idx + 1);
        log.set("tweet.total", inputs.length);
        const result = await withTweetLog(log, () =>
          processSingleTweet({ post, bot, logger })
        );

        completed.outcome = result.outcome;
        completed.outcomeReason = result.outcomeReason;
        completed.noteText = result.noteText;
        const csvRow = resultToCsvRow(input, bot.id, result, log);
        output.appendRow(csvRow);

        // Build CsvRow for evaluation
        csvRowData = {
          url: input.url,
          text: result.pipelineResult?.post?.text ?? "",
          needs_note: input.needsNote ?? "",
          ground_truth_note: input.groundTruthNote ?? "",
          bot_id: bot.id,
          note_status: result.noteStatus ?? "",
          outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
          note_text: result.noteText ?? "",
          logs: log ? JSON.stringify(Object.fromEntries(log)) : "",
        };
      } catch (err: any) {
        console.error(`[runOnVideos] ERROR ${input.url}: ${err?.message}`);
        output.appendRow(errorToCsvRow(input, err?.message ?? "unknown"));
        errorCount++;
      }

      // Categorize via AI judge (if applicable)
      if (csvRowData) {
        try {
          const categorized = await categorizeRow(csvRowData);
          completed.categorized = categorized;
          if (categorized) categorizedRows.push(categorized);
        } catch (err: any) {
          console.error(`[runOnVideos] Judge failed for ${input.url}: ${err?.message}`);
        }
      }

      completedCount++;
      results.push(completed);
      console.log(`\n${formatResult(completed, completedCount, inputs.length)}`);
    });
  }

  await queue.onIdle();

  // Write categorized JSONs and print summary
  const counts = writeResultJsons(categorizedRows, output.folderPath);
  printSummary(counts, inputs.length, errorCount, output.folderPath);

  // Cleanup downloaded videos
  try {
    fs.rmSync(downloadDir, { recursive: true, force: true });
    console.log(`[runOnVideos] Cleaned up temp directory`);
  } catch { }

  try {
    await closeBrowser();
  } catch { }
}

main().catch((err) => {
  console.error("[runOnVideos] Fatal error:", err);
  process.exit(1);
});
