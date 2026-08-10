/**
 * yt-dlp Download
 *
 * Shared helper for downloading videos + metadata from any platform yt-dlp
 * supports (X, YouTube, TikTok, Vimeo, Twitch, etc.). Used both by the local
 * runOnVideos harness (combined `downloadWithYtDlp`) and by the source
 * verifier (granular `fetchYtDlpMetadata`, `downloadVideoWithYtDlp`,
 * `fetchAutoSubs`).
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

/** YouTube refuses video requests from datacenter IPs ("Sign in to confirm
 *  you're not a bot"), so CI routes them through a residential proxy. Set
 *  YTDLP_PROXY_URL to enable. Other sites are always fetched directly —
 *  they work without a proxy and proxy traffic is paid per GB. */
function ytDlpProxyArgs(url: string): string[] {
  const proxy = process.env.YTDLP_PROXY_URL;
  return proxy && YOUTUBE_URL_RE.test(url) ? ["--proxy", proxy] : [];
}

const PROXY_RETRY_ATTEMPTS = 3;

/** Run yt-dlp, adding the proxy flag when the URL needs it. Proxied calls are
 *  retried: the proxy pool rotates its egress IP per connection, and it
 *  occasionally hands out an IP YouTube has already flagged. A retry simply
 *  draws a fresh IP. Direct calls run once. */
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
 * Combined metadata + default-quality download in one yt-dlp invocation.
 * Used by runOnVideos. The verifier uses the granular functions below
 * because it wants to decide quality/auto-sub strategy based on duration.
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

/** Metadata-only — no download. Used to size the download up front. */
export function fetchYtDlpMetadata(url: string): YtDlpMetadata {
  try {
    return JSON.parse(execYtDlp(url, ["-J", "--skip-download", url]));
  } catch (err: any) {
    throw new Error(`yt-dlp metadata failed for ${url}: ${err?.message}`);
  }
}

/**
 * Download only — assumes metadata was already fetched. `quality: "low"`
 * forces ≤240p (lowest available stream). For videos where we only need a
 * few sampled frames, this dramatically shrinks the byte count.
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
 * Fetch auto-generated captions and return the plain text. Returns null when
 * the URL has no auto-subs available (e.g. uploader disabled them, or the
 * video is in a language we didn't request).
 */
export function fetchAutoSubs(url: string, outputDir: string, lang: string = "en"): string | null {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    execYtDlp(url, ["--write-auto-sub", "--sub-lang", lang, "--skip-download", "-o", outputTemplate, url]);
  } catch {
    // yt-dlp errors when no subs are available — treat as "no subs" rather than throw.
    return null;
  }
  // yt-dlp writes the sub file as <id>.<lang>.vtt (sometimes ttml). Pick the first one.
  const matches = fs.readdirSync(outputDir).filter((f) => f.endsWith(".vtt") || f.endsWith(".ttml"));
  if (!matches.length) return null;
  const subPath = path.join(outputDir, matches[0]!);
  const raw = fs.readFileSync(subPath, "utf-8");
  return parseSubtitleToText(raw);
}

/**
 * Like fetchAutoSubs but keeps per-cue timestamps. Prefers human-authored subs
 * and falls back to auto-generated. Returns null when no subs are available.
 * Used to attribute extracted claims to a point in the video.
 */
export function fetchTimedTranscript(url: string, outputDir: string, lang: string = "en"): SubtitleCue[] | null {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  try {
    execYtDlp(url, ["--write-subs", "--write-auto-subs", "--sub-lang", lang, "--skip-download", "-o", outputTemplate, url]);
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
  // Quality filter or extension fallback: scan the directory for any media file.
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

/** "00:01:23.456" / "01:23,456" / "83.4" → seconds. */
function parseTimecode(tc: string): number {
  return tc.replace(",", ".").split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parse a WEBVTT/SRT subtitle file into timestamped cues. Applies the same
 * cleaning + consecutive-duplicate dedup the plain-text path needs for
 * YouTube's rolling auto-subs, but tags each surviving line with the start/end
 * of its enclosing cue.
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
      // "00:00:00.000 --> 00:00:02.000 align:start position:0%"
      curStart = parseTimecode(line.slice(0, arrow).trim().split(/\s+/).pop() ?? "0");
      curEnd = parseTimecode(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "0");
      continue;
    }
    if (/^\d+$/.test(line)) continue; // SRT sequence numbers
    // Strip cue tags, decode HTML entities, collapse the resulting whitespace.
    const cleaned = decodeHtmlEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    // YouTube auto-subs duplicate every line as they build up word-by-word.
    // Skip a line if it's identical to the immediately preceding one.
    if (cleaned === prev) continue;
    cues.push({ start: curStart, end: curEnd, text: cleaned });
    prev = cleaned;
  }
  return cues;
}

function parseSubtitleToText(content: string): string {
  return parseSubtitleToCues(content).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
}
