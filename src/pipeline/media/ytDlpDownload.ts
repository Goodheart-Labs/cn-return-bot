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

export interface YtDlpResult {
  meta: YtDlpMetadata;
  videoPath: string | null;
}

const YT_DLP_TIMEOUT_MS = 120_000;

export function downloadWithYtDlp(url: string, outputDir: string): YtDlpResult {
  const videoOutput = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    const metadataJson = execSync(
      `yt-dlp -J -o "${videoOutput}" "${url}"`,
      { timeout: YT_DLP_TIMEOUT_MS, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const meta: YtDlpMetadata = JSON.parse(metadataJson);

    execSync(
      `yt-dlp -o "${videoOutput}" "${url}"`,
      { timeout: YT_DLP_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
    );

    const expectedPath = meta.filename ?? meta._filename ?? path.join(outputDir, `${meta.id}.${meta.ext ?? "mp4"}`);
    const videoPath = fs.existsSync(expectedPath) ? expectedPath : null;

    return { meta, videoPath };
  } catch (err: any) {
    throw new Error(`yt-dlp failed for ${url}: ${err?.message}`);
  }
}
