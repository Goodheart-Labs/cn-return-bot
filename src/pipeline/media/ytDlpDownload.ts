/**
 * yt-dlp Download
 *
 * Shared helper for downloading videos + metadata from any platform yt-dlp
 * supports (X, YouTube, TikTok, Vimeo, Twitch, etc.). Used both by the local
 * runOnVideos harness and by the source verifier when it needs to describe a
 * cited video URL.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface YtDlpMetadata {
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
  channel_id?: string;
  timestamp?: number;
  webpage_url?: string;
  ext?: string;
  filename?: string;
  _filename?: string;
  display_id?: string;
}

export type YtDlpKind = "video" | "image";

export interface YtDlpResult {
  meta: YtDlpMetadata;
  filePath: string | null;
  kind: YtDlpKind | null;
}

const VIDEO_EXTS = [".mp4", ".webm", ".mkv", ".mov", ".m4v", ".m4a", ".mp3", ".ogg", ".opus"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif", ".bmp"];

function classifyByExtension(filePath: string): YtDlpKind | null {
  const lower = filePath.toLowerCase();
  if (VIDEO_EXTS.some((e) => lower.endsWith(e))) return "video";
  if (IMAGE_EXTS.some((e) => lower.endsWith(e))) return "image";
  return null;
}

const YT_DLP_TIMEOUT_MS = 120_000;

export function downloadWithYtDlp(url: string, outputDir: string): YtDlpResult {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    const metadataJson = execSync(
      `yt-dlp -J -o "${outputTemplate}" "${url}"`,
      { timeout: YT_DLP_TIMEOUT_MS, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const meta: YtDlpMetadata = JSON.parse(metadataJson);

    execSync(
      `yt-dlp -o "${outputTemplate}" "${url}"`,
      { timeout: YT_DLP_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
    );

    const expectedPath = meta.filename ?? meta._filename ?? path.join(outputDir, `${meta.id}.${meta.ext ?? "mp4"}`);
    const filePath = fs.existsSync(expectedPath) ? expectedPath : null;
    const kind = filePath ? classifyByExtension(filePath) : null;

    return { meta, filePath, kind };
  } catch (err: any) {
    throw new Error(`yt-dlp failed for ${url}: ${err?.message}`);
  }
}
