/**
 * yt-dlp Download
 *
 * Downloads media and its metadata from any site yt-dlp supports, such as
 * YouTube, TikTok, Vimeo and Twitch, and runs every yt-dlp process the
 * pipelines start. The local runOnVideos harness calls the combined
 * `downloadWithYtDlp`. The source verifier calls `fetchYtDlpMetadata` and
 * `downloadMediaWithYtDlp` separately, because the duration decides what it
 * downloads. Captions live in youtubeCaptions.ts.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { hideProxyAddress, withResidentialProxy } from "../utils/residentialProxy";

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

const VIDEO_EXTS = [".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv", ".mpeg", ".mpg", ".avi", ".flv", ".3gp", ".m4a", ".mp3", ".ogg", ".opus"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif", ".bmp"];

function classifyByExtension(filePath: string): YtDlpKind | null {
  const lower = filePath.toLowerCase();
  if (VIDEO_EXTS.some((e) => lower.endsWith(e))) return "video";
  if (IMAGE_EXTS.some((e) => lower.endsWith(e))) return "image";
  return null;
}

/** How long one yt-dlp call may run. The source verifier downloads no video
 *  longer than 10 minutes, at 360p at most. That is 10 to 20 MB, and the
 *  residential proxy moves it in well under a minute even on a slow device.
 *  On 2026-09-29 a 95 MB download was killed at this limit twice, which is why
 *  longer videos are no longer downloaded at all. */
const YT_DLP_TIMEOUT_MS = 120_000;

/** Which file of a video to download. The verifier only needs the sound when
 *  Whisper will transcribe it. */
export type VideoDownload = "pictures_only" | "with_sound";

/** yt-dlp format selectors, in yt-dlp's own rule language for choosing among
 *  the files a video is offered in. The alternatives are separated by slashes
 *  and the first one that matches wins. Every download is capped at 360p,
 *  because the frames are scaled to 640 pixels wide, which is exactly 360p.
 *
 *  "bv" is the best video-only stream, a file with pictures and no sound, and
 *  "wv" the smallest. YouTube serves almost everything that way. "b" and "w"
 *  are the best and the smallest combined file, for sites that do not. "wa" is
 *  the smallest sound-only stream, which yt-dlp merges onto the pictures with
 *  ffmpeg. The smallest is plenty for Whisper, which hears 16 kHz mono.
 *
 *  The old rule was "worst[height<=240]/worst". Plain "worst" only matches a
 *  combined file, and YouTube no longer offers one we can download, so every
 *  such download failed with "Requested format is not available". */
const FORMAT_SELECTORS: Record<VideoDownload, string> = {
  pictures_only: "bv[height<=360]/wv/b[height<=360]/w",
  with_sound: "b[height<=360]/bv[height<=360]+wa/w/wv+wa",
};

const YOUTUBE_URL_RE = /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i;

/** YouTube refuses video requests that come from a datacenter IP. It answers
 *  them with "Sign in to confirm you're not a bot". So YouTube requests go
 *  through the residential proxy, with its retries. Every other site is always
 *  fetched directly. Those sites work without a proxy, and proxy traffic is
 *  paid for by the gigabyte. */
export function throughProxyIfYoutube<T>(
  url: string,
  attempt: (proxyUrl: string | undefined) => Promise<T>,
  isRetryable?: (err: unknown) => boolean,
): Promise<T> {
  return YOUTUBE_URL_RE.test(url) ? withResidentialProxy(url, attempt, isRetryable) : attempt(undefined);
}

export const proxyArgs = (proxyUrl: string | undefined): string[] => (proxyUrl ? ["--proxy", proxyUrl] : []);

/** yt-dlp's JSON dump of a video with many formats can pass a megabyte. */
const YT_DLP_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface YtDlpRun {
  stdout: string;
  stderr: string;
  /** Set when yt-dlp exited with an error, was killed, or could not start. */
  error: (Error & { killed?: boolean; code?: unknown }) | null;
}

/** Runs yt-dlp without blocking. The services machine checks several claims
 *  at once in one process, and a blocking call would stall all of them for as
 *  long as yt-dlp runs. */
export function runYtDlp(args: string[], timeoutMs: number): Promise<YtDlpRun> {
  return new Promise((resolve) => {
    execFile("yt-dlp", args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: YT_DLP_MAX_OUTPUT_BYTES }, (error, stdout, stderr) =>
      resolve({ stdout, stderr, error }),
    );
  });
}

/** What yt-dlp prints when YouTube itself answered that the video or the
 *  requested file does not exist. A fresh proxy connection gets the same
 *  answer, so these failures are not retried. Between 2026-09-07 and
 *  2026-09-29 every video that failed with one of these was also missing
 *  from YouTube's public oEmbed lookup. */
const YOUTUBE_PERMANENT_ANSWER_RE = /This video is unavailable|Video unavailable|Requested format is not available/i;

/** Run yt-dlp and return what it printed, or throw when it failed. A YouTube
 *  call goes through the residential proxy, and a failure is retried on a
 *  fresh connection unless YouTube answered that the video or the file does
 *  not exist. The thrown error's message is yt-dlp's command line and
 *  complaint, with the proxy's credentials taken out. */
async function execYtDlp(url: string, args: string[]): Promise<string> {
  return throughProxyIfYoutube(
    url,
    async (proxyUrl) => {
      const run = await runYtDlp([...proxyArgs(proxyUrl), ...args], YT_DLP_TIMEOUT_MS);
      if (run.error) throw new Error(hideProxyAddress(run.error.message));
      return run.stdout;
    },
    (err) => !(err instanceof Error && YOUTUBE_PERMANENT_ANSWER_RE.test(err.message)),
  );
}

/**
 * Fetch the metadata and download the file as yt-dlp chooses by default. This
 * runs yt-dlp twice. The first call only dumps the metadata as JSON, the second
 * one downloads the file into `outputDir`, which must be empty.
 */
export async function downloadWithYtDlp(url: string, outputDir: string): Promise<YtDlpResult> {
  try {
    const meta: YtDlpMetadata = JSON.parse(await execYtDlp(url, ["-J", "--skip-download", url]));
    return { meta, ...(await downloadMediaWithYtDlp(url, outputDir)) };
  } catch (err: any) {
    throw new Error(`yt-dlp failed for ${url}: ${err?.message}`);
  }
}

/** Fetch the metadata without downloading anything. The caller uses it to work
 *  out how long a video is before deciding whether to download it. */
export async function fetchYtDlpMetadata(url: string): Promise<YtDlpMetadata> {
  try {
    return JSON.parse(await execYtDlp(url, ["-J", "--skip-download", url]));
  } catch (err: any) {
    throw new Error(`yt-dlp metadata failed for ${url}: ${err?.message}`);
  }
}

/**
 * Download the file into `outputDir`, which must be empty. A `video` choice
 * picks one of the 360p format selectors above. Without one, yt-dlp picks the
 * file itself, which is right for an image post, where a height cap could pick
 * a thumbnail over the real picture.
 */
export async function downloadMediaWithYtDlp(
  url: string,
  outputDir: string,
  video?: VideoDownload,
): Promise<{ filePath: string | null; kind: YtDlpKind | null }> {
  const formatArgs = video ? ["-f", FORMAT_SELECTORS[video]] : [];
  try {
    await execYtDlp(url, [...formatArgs, "-o", path.join(outputDir, "%(id)s.%(ext)s"), url]);
  } catch (err: any) {
    throw new Error(`yt-dlp download failed for ${url}: ${err?.message}`);
  }
  return findDownloadedFile(outputDir);
}

/** The media file yt-dlp wrote. Its name depends on the format yt-dlp picked,
 *  so the directory is scanned instead of predicting it. */
function findDownloadedFile(outputDir: string): { filePath: string | null; kind: YtDlpKind | null } {
  for (const file of fs.readdirSync(outputDir)) {
    const filePath = path.join(outputDir, file);
    const kind = classifyByExtension(filePath);
    if (kind) return { filePath, kind };
  }
  return { filePath: null, kind: null };
}
