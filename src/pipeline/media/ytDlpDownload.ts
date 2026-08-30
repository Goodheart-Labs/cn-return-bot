/**
 * yt-dlp Download
 *
 * Shared helper for downloading videos and their metadata from any platform
 * yt-dlp supports, such as X, YouTube, TikTok, Vimeo and Twitch. The local
 * runOnVideos harness calls the combined `downloadWithYtDlp`. The media
 * analysis behind the source verifier calls the granular
 * `fetchYtDlpMetadata`, `downloadVideoWithYtDlp` and `fetchAutoSubs` instead.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { decodeHtmlEntities } from "../utils/html";

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
const LOW_QUALITY_FORMAT = "worst[height<=240]/worst";

export type YtDlpQuality = "default" | "low";

const YOUTUBE_URL_RE = /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i;

/** YouTube refuses video requests that come from a datacenter IP. It answers
 *  them with "Sign in to confirm you're not a bot". CI therefore sends its
 *  YouTube requests through a residential proxy. Setting YTDLP_PROXY_URL turns
 *  that on. Every other site is always fetched directly. Those sites work
 *  without a proxy, and proxy traffic is paid for by the gigabyte. */
function ytDlpProxyArgs(url: string): string[] {
  const proxy = process.env.YTDLP_PROXY_URL;
  return proxy && YOUTUBE_URL_RE.test(url) ? ["--proxy", proxy] : [];
}

const PROXY_RETRY_ATTEMPTS = 3;

/** Run yt-dlp, adding the proxy flag when the URL needs it. A proxied call is
 *  retried a few times. The proxy pool picks a new egress IP for every
 *  connection, and now and then it hands out an IP that YouTube has already
 *  flagged. A retry simply draws a fresh IP. A direct call runs only once. */
export function execYtDlp(url: string, args: string[]): string {
  const proxyArgs = ytDlpProxyArgs(url);
  const attempts = proxyArgs.length > 0 ? PROXY_RETRY_ATTEMPTS : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return execFileSync("yt-dlp", [...proxyArgs, ...args], {
        timeout: YT_DLP_TIMEOUT_MS,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      lastError = err;
      if (attempt < attempts) console.warn(`yt-dlp attempt ${attempt}/${attempts} failed for ${url}, retrying with a fresh proxy IP`);
    }
  }
  throw lastError;
}

/**
 * Fetch the metadata and download the video at the default quality. This runs
 * yt-dlp twice. The first call only dumps the metadata as JSON, the second one
 * downloads the file. runOnVideos uses this function. The source verifier uses
 * the granular functions below instead. It needs the duration first, because
 * the duration decides which quality it downloads and whether it asks for
 * auto-generated subtitles.
 */
export function downloadWithYtDlp(url: string, outputDir: string): YtDlpResult {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    const meta: YtDlpMetadata = JSON.parse(execYtDlp(url, ["-J", "-o", outputTemplate, url]));

    execYtDlp(url, ["-o", outputTemplate, url]);

    return { meta, ...resolveDownloadedFile(meta, outputDir) };
  } catch (err: any) {
    throw new Error(`yt-dlp failed for ${url}: ${err?.message}`);
  }
}

/** Fetch the metadata without downloading anything. The caller uses it to work
 *  out how large the download would be before starting it. */
export function fetchYtDlpMetadata(url: string): YtDlpMetadata {
  try {
    return JSON.parse(execYtDlp(url, ["-J", "--skip-download", url]));
  } catch (err: any) {
    throw new Error(`yt-dlp metadata failed for ${url}: ${err?.message}`);
  }
}

/**
 * Download the file. The caller must have fetched the metadata already.
 * A `quality` of "low" asks for the worst stream that is 240p or smaller. When
 * the video has no stream that small, yt-dlp falls back to the worst stream it
 * does have. For a video where we only sample a few frames, this shrinks the
 * number of downloaded bytes a lot.
 */
export function downloadVideoWithYtDlp(
  url: string,
  outputDir: string,
  meta: YtDlpMetadata,
  quality: YtDlpQuality = "default",
): { filePath: string | null; kind: YtDlpKind | null } {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  const formatArgs = quality === "low" ? ["-f", LOW_QUALITY_FORMAT] : [];
  try {
    execYtDlp(url, [...formatArgs, "-o", outputTemplate, url]);
    return resolveDownloadedFile(meta, outputDir);
  } catch (err: any) {
    throw new Error(`yt-dlp download failed for ${url}: ${err?.message}`);
  }
}

/**
 * Fetch the automatically generated captions and return them as plain text.
 * This returns null when the URL has no auto-generated captions. That happens
 * when the uploader turned them off. It also happens when the video is in a
 * language we did not ask for.
 */
export function fetchAutoSubs(url: string, outputDir: string, lang: string = "en"): string | null {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    execYtDlp(url, ["--write-auto-sub", "--sub-lang", lang, "--skip-download", "-o", outputTemplate, url]);
  } catch {
    // yt-dlp fails when the video has no subtitles. We report that as "no
    // subtitles" instead of throwing.
    return null;
  }
  // yt-dlp writes the subtitle file as <id>.<lang>.vtt, and sometimes as ttml.
  // We take the first file we find.
  const matches = fs.readdirSync(outputDir).filter((f) => f.endsWith(".vtt") || f.endsWith(".ttml"));
  if (!matches.length) return null;
  const subPath = path.join(outputDir, matches[0]!);
  const raw = fs.readFileSync(subPath, "utf-8");
  return parseSubtitleToText(raw);
}

/**
 * Works like fetchAutoSubs, but keeps the timestamps of every cue. It asks for
 * the subtitles a human wrote and falls back to the automatically generated
 * ones. It returns null when the video has no subtitles at all. The timestamps
 * let us point an extracted claim at the moment in the video where it was said.
 */
export function fetchTimedTranscript(url: string, outputDir: string, lang: string = "en"): SubtitleCue[] | null {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    // Writing subtitles needs no video formats. Without the ignore flag a
    // degraded player response from a flagged proxy IP, which lists no
    // formats, aborts the call before the subtitles are fetched.
    execYtDlp(url, ["--write-subs", "--write-auto-subs", "--sub-lang", lang, "--skip-download", "--ignore-no-formats-error", "-o", outputTemplate, url]);
  } catch {
    return null;
  }
  const matches = fs.readdirSync(outputDir).filter((f) => f.endsWith(".vtt") || f.endsWith(".ttml") || f.endsWith(".srt"));
  if (!matches.length) return null;
  const raw = fs.readFileSync(path.join(outputDir, matches[0]!), "utf-8");
  const cues = parseSubtitleToCues(raw);
  return cues.length ? cues : null;
}

function resolveDownloadedFile(meta: YtDlpMetadata, outputDir: string): { filePath: string | null; kind: YtDlpKind | null } {
  const expected = meta.filename ?? meta._filename ?? path.join(outputDir, `${meta.id}.${meta.ext ?? "mp4"}`);
  if (fs.existsSync(expected)) {
    return { filePath: expected, kind: classifyByExtension(expected) };
  }
  // A quality filter or a fallback extension can make yt-dlp write a file name
  // we did not predict. So we scan the directory for any media file.
  for (const file of fs.readdirSync(outputDir)) {
    const full = path.join(outputDir, file);
    const kind = classifyByExtension(full);
    if (kind) return { filePath: full, kind };
  }
  return { filePath: null, kind: null };
}

export interface SubtitleCue {
  /** Start time in seconds (float). */
  start: number;
  /** End time in seconds (float). */
  end: number;
  text: string;
}

/** Turn a subtitle timecode into seconds. It accepts the forms "00:01:23.456",
 *  "01:23,456" and "83.4". */
function parseTimecode(tc: string): number {
  return tc.replace(",", ".").split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parse a WEBVTT or SRT subtitle file into cues that carry a start and an end
 * time. Every line is stripped of its cue tags and its HTML entities, and a
 * line that repeats the line before it is dropped. Each surviving line is
 * tagged with the start and the end of the cue it sits in. The plain text
 * version below builds on this function and joins the cue texts together.
 */
export function parseSubtitleToCues(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let prev = "";
  let curStart = 0;
  let curEnd = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (line.startsWith("NOTE ")) continue;
    const arrow = line.indexOf("-->");
    if (arrow !== -1) {
      // A timing line looks like "00:00:00.000 --> 00:00:02.000 align:start position:0%".
      // It can carry extra layout settings, so we keep only the word next to
      // the arrow on each side.
      curStart = parseTimecode(line.slice(0, arrow).trim().split(/\s+/).pop() ?? "0");
      curEnd = parseTimecode(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "0");
      continue;
    }
    if (/^\d+$/.test(line)) continue; // A line of only digits is an SRT cue number.
    const cleaned = decodeHtmlEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    // YouTube's automatic captions build a line up word by word, so they repeat
    // the same line many times.
    if (cleaned === prev) continue;
    cues.push({ start: curStart, end: curEnd, text: cleaned });
    prev = cleaned;
  }
  return cues;
}

function parseSubtitleToText(content: string): string {
  return parseSubtitleToCues(content).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
}
