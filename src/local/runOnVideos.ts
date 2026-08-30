/**
 * Run On Videos
 *
 * Runs the pipeline on videos from any platform, such as X, YouTube or TikTok.
 * yt-dlp extracts the metadata, so no X API credentials are needed.
 *
 * Input: a CSV file with these columns:
 *   - url (required): a link to the video or the post
 *   - needs_note (optional): the ground truth label, either "yes" or "no"
 *   - ground_truth_note (optional): what the note should say
 *
 * Usage:
 *   bun run src/local/runOnVideos.ts [flags] <input.csv | url...>
 *
 * Flags:
 *   --pick test=variant     Force an A/B test variant. Repeatable. Use
 *                           --pick bot=<id> to force a specific bot.
 *   --max <n>               Limit the number of inputs.
 *   --reversed              Process the inputs in reverse order, newest last.
 *   --concurrency <n>       How many workers run in parallel. The default is 5.
 *   --name <label>          The name the run gets in the dashboard. It is
 *                           derived from the input if you do not pass one.
 */

import "dotenv/config";
import { captureProdSupabaseCreds } from "./prodSupabaseCreds";
captureProdSupabaseCreds();

// Route Supabase to a local instance when one is configured. This has to happen
// before anything imports Supabase.
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
import { downloadWithYtDlp, type YtDlpMetadata, type YtDlpKind } from "../pipeline/media/ytDlpDownload";

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

function buildPostFromDownload(meta: YtDlpMetadata, filePath: string | null, kind: YtDlpKind | null, url: string): Post {
  const text = [meta.title, meta.description].filter(Boolean).join("\n\n");

  const media: Post["media"] = [];
  if (filePath && kind === "video") {
    media.push({
      type: "video",
      url: filePath,
      duration_ms: meta.duration ? Math.round(meta.duration * 1000) : undefined,
      variants: [{ url: filePath, content_type: "video/mp4" }],
    });
  } else if (filePath && kind === "image") {
    media.push({
      type: "photo",
      url: filePath,
    });
  } else if (meta.thumbnail) {
    media.push({
      type: "photo",
      url: meta.thumbnail,
    });
  }

  const postId = meta.display_id ?? extractIdFromUrl(url);
  const createdAt = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : new Date().toISOString();

  return {
    id: postId,
    author_id: meta.channel_id ?? meta.uploader_id ?? "unknown",
    author_name: meta.uploader,
    created_at: createdAt,
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

  const parsed = parseCliArgs("runOnVideos");

  const downloadDir = path.join(tmpdir(), `cn-runOnVideos-${Date.now()}`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const fetchPost: PostFetcher = async (input) => {
    const { meta, filePath, kind } = downloadWithYtDlp(input.url, downloadDir);
    const post = buildPostFromDownload(meta, filePath, kind, input.url);
    return { post, title: meta.title?.slice(0, 80) ?? "" };
  };

  await runPipeline({
    scriptName: "runOnVideos",
    folderPrefix: "videos",
    inputs: parsed.inputs,
    fetchPost,
    forcedPicks: parsed.forcedPicks,
    datasetName: parsed.datasetName,
    reversed: parsed.reversed,
    concurrency: parsed.concurrency,
    runName: parsed.runName,
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
