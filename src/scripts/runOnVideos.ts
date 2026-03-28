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
 *   bun run src/scripts/runOnVideos.ts [--bot <bot-id>] <url1> <url2> ...
 */

import "dotenv/config";

// Route Supabase to local instance (must happen before any Supabase imports)
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import type { Post } from "../api/fetchEligiblePosts";
import { parseCliArgs, runPipeline, type PostFetcher } from "./localPipelineRunner";

// ---------------------------------------------------------------------------
// yt-dlp types & helpers
// ---------------------------------------------------------------------------

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

function extractIdFromUrl(url: string): string {
  const tweetMatch = url.match(/status\/(\d+)/);
  if (tweetMatch) return tweetMatch[1]!;

  const ytMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return ytMatch[1]!;

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
    const output = execSync(
      `yt-dlp -J -o "${videoOutput}" "${url}"`,
      { timeout: 120_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const meta: YtDlpMetadata = JSON.parse(output);

    execSync(
      `yt-dlp -o "${videoOutput}" "${url}"`,
      { timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] }
    );

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
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }

  const { inputs, forcedBotId, datasetName } = parseCliArgs("runOnVideos");

  const downloadDir = path.join(tmpdir(), `cn-runOnVideos-${Date.now()}`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const fetchPost: PostFetcher = async (input) => {
    const { meta, videoPath } = downloadWithYtDlp(input.url, downloadDir);
    const post = buildPostFromDownload(meta, videoPath, input.url);
    return { post, title: meta.title?.slice(0, 80) ?? "" };
  };

  await runPipeline({
    scriptName: "runOnVideos",
    folderPrefix: "videos",
    inputs,
    fetchPost,
    forcedBotId,
    datasetName,
    cleanup: async () => {
      fs.rmSync(downloadDir, { recursive: true, force: true });
      console.log(`[runOnVideos] Cleaned up temp directory`);
    },
  });
}

main().catch((err) => {
  console.error("[runOnVideos] Fatal error:", err);
  process.exit(1);
});
