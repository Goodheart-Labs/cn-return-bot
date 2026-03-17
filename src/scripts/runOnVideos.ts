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
import type { Post } from "../api/fetchEligiblePosts";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

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
  const lines = content.split("\n");

  if (lines.length < 2) {
    console.error("CSV must have a header row and at least one data row");
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf("url");
  if (urlIdx === -1) {
    console.error('CSV must have a "url" column');
    process.exit(1);
  }

  const needsNoteIdx = header.indexOf("needs_note");
  const groundTruthIdx = header.indexOf("ground_truth_note");

  const rows: InputRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCsvLine(line);
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

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
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
    const output = execSync(`yt-dlp -J -o "${videoOutput}" "${url}"`, {
      timeout: 120_000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const meta: YtDlpMetadata = JSON.parse(output);

    // Now download separately (--dump-json doesn't always download reliably)
    execSync(`yt-dlp -o "${videoOutput}" "${url}"`, { timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] });

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
  "outcome",
  "note_text",
  "source_verification",
  "evaluation_score",
  "search_results",
  "citations",
] as const;

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function resultToCsvRow(input: InputRow, botId: string, result: ProcessTweetResult): string {
  const pr = result.pipelineResult;
  const svScore = result.scores.find((s) => s.type === "source_verification");
  const citations = pr?.searchContextResult?.citations?.join("; ") ?? "";

  const fields: Record<(typeof OUTPUT_HEADERS)[number], string> = {
    url: input.url,
    text: pr?.post?.text ?? "",
    needs_note: input.needsNote ?? "",
    ground_truth_note: input.groundTruthNote ?? "",
    bot_id: botId,
    outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
    note_text: result.noteText ?? "",
    source_verification: svScore?.label ?? (svScore ? String(svScore.value) : "skipped"),
    evaluation_score: result.evaluationScore?.toFixed(2) ?? "",
    search_results: pr?.searchContextResult?.searchResults ?? "",
    citations,
  };

  return OUTPUT_HEADERS.map((h) => escapeCsvField(fields[h])).join(",");
}

function errorToCsvRow(input: InputRow, errorMsg: string): string {
  return OUTPUT_HEADERS.map((h) =>
    escapeCsvField(
      h === "url"
        ? input.url
        : h === "needs_note"
          ? (input.needsNote ?? "")
          : h === "ground_truth_note"
            ? (input.groundTruthNote ?? "")
            : h === "outcome"
              ? `error: ${errorMsg}`
              : "",
    ),
  ).join(",");
}

function writeCsv(rows: string[]): string {
  const outDir = path.join(process.cwd(), "tryout-results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const outFile = path.join(outDir, `videos-${timestamp}.csv`);

  const content = [OUTPUT_HEADERS.join(","), ...rows].join("\n");
  fs.writeFileSync(outFile, content, "utf8");
  return outFile;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run src/scripts/runOnVideos.ts [--bot <bot-id>] <input.csv>");
    console.error("       bun run src/scripts/runOnVideos.ts [--bot <bot-id>] <url1> <url2> ...");
    console.error(
      "\nAvailable bots:",
      getEnabledBots()
        .map((b) => b.id)
        .join(", "),
    );
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
      console.error(
        "Available bots:",
        getEnabledBots()
          .map((b) => b.id)
          .join(", "),
      );
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

  const csvRows: string[] = [];

  for (const [idx, input] of inputs.entries()) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[runOnVideos] ${idx + 1}/${inputs.length}: ${input.url}`);
    if (input.needsNote) console.log(`[runOnVideos] Ground truth: needs_note=${input.needsNote}`);
    console.log("=".repeat(60));

    try {
      // Download video and extract metadata with yt-dlp
      console.log(`[runOnVideos] Downloading and extracting metadata...`);
      const { meta, videoPath } = downloadWithYtDlp(input.url, downloadDir);
      console.log(`[runOnVideos] Title: ${meta.title?.slice(0, 100)}`);
      if (videoPath) console.log(`[runOnVideos] Downloaded video: ${videoPath}`);

      // Build Post object with local video path
      const post = buildPostFromDownload(meta, videoPath, input.url);
      console.log(`[runOnVideos] Built post: ${post.media.length} media item(s)`);

      // Run pipeline
      const bot = forcedBotId ? getBotById(forcedBotId)! : selectRandomBot();
      const result = await processSingleTweet({ post, bot, logger });

      csvRows.push(resultToCsvRow(input, bot.id, result));
    } catch (err: any) {
      console.error(`[runOnVideos] Failed:`, err?.message);
      csvRows.push(errorToCsvRow(input, err?.message ?? "unknown"));
    }
  }

  const csvFile = writeCsv(csvRows);
  console.log(`\n[runOnVideos] Results written to ${csvFile}`);

  // Cleanup downloaded videos
  try {
    fs.rmSync(downloadDir, { recursive: true, force: true });
    console.log(`[runOnVideos] Cleaned up temp directory`);
  } catch {}

  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[runOnVideos] Fatal error:", err);
  process.exit(1);
});
