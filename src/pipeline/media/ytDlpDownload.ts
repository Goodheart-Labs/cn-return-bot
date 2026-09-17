/**
 * yt-dlp Download
 *
 * Shared helper for downloading videos and their metadata from any platform
 * yt-dlp supports, such as X, YouTube, TikTok, Vimeo and Twitch. The local
 * runOnVideos harness calls the combined `downloadWithYtDlp`. The media
 * analysis behind the source verifier calls the granular
 * `fetchYtDlpMetadata`, `downloadVideoWithYtDlp` and `fetchAutoSubs` instead.
 */

import { execFileSync, spawnSync } from "child_process";
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

/** YouTube could not be reached, as opposed to YouTube answering that the
 *  video has no captions. The caller must treat this as a network failure:
 *  retry later, never record it as a fact about the video. Before GOO-169
 *  every such failure became "No transcript available" and the item was
 *  marked a permanent error. */
export class YoutubeUnreachableError extends Error {
  constructor(url: string, reason: string) {
    super(`YouTube could not be reached for ${url}: ${reason}`);
    this.name = "YoutubeUnreachableError";
  }
}

/** What yt-dlp prints when the trouble is the path to YouTube rather than the
 *  video. The first three are the residential proxy's player API requests
 *  hanging or being refused. The PO token line means the token provider
 *  (see ops/cn-pot-provider.service) is not running or not reachable, in
 *  which case the web client sees the captions and discards them. */
const YOUTUBE_UNREACHABLE_RE =
  /Unable to download (API page|webpage)|operation timed out|ETIMEDOUT|wrong version number|HTTP Error 429|Sign in to confirm|PO Token was not provided|require a PO Token|Error fetching PO Token/i;

/** How long one caption call may run before it is killed and counted as not
 *  having reached YouTube. A good call through the proxy takes 15 to 25
 *  seconds; one that is still running after a minute is hung on a dead proxy
 *  address, and a fresh address is what helps, not more waiting. */
const CAPTION_CALL_TIMEOUT_MS = 60_000;

/** Captions are fetched as YouTube's own web player, which is the one client
 *  that lists every caption track, and which needs a PO token (a proof that
 *  the request comes from a real player) to download them. yt-dlp obtains the
 *  token from the bgutil provider plugin, which asks a small local server;
 *  nothing is passed here for that, the plugin finds it at its default
 *  address. The other clients yt-dlp would otherwise try first spend a
 *  minute and a half timing out through the proxy before falling back. */
const YOUTUBE_WEB_CLIENT_ARGS = ["--extractor-args", "youtube:player_client=web"];

/** One yt-dlp process, with the proxy when the URL needs it, returning what
 *  it wrote on both streams. Unlike execYtDlp it never throws on a non-zero
 *  exit, because the subtitle calls have to read stderr in every case: with
 *  --ignore-no-formats-error yt-dlp exits zero after a request that never got
 *  an answer, and stderr is the only place that says so. */
function runYtDlp(url: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const proxyArgs = ytDlpProxyArgs(url);
  const clientArgs = YOUTUBE_URL_RE.test(url) ? YOUTUBE_WEB_CLIENT_ARGS : [];
  const result = spawnSync("yt-dlp", [...proxyArgs, ...clientArgs, ...args], { timeout: CAPTION_CALL_TIMEOUT_MS, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: (result.stderr ?? "") + (result.error ? `\n${result.error.message}` : "") };
}

/** Runs a subtitle call until it got what it came for or YouTube has
 *  answered. `found` reads the result: caption files on disk, or tracks in a
 *  listing. Success is judged by that and never by the warnings, because a
 *  call that wrote the captions can still print "HTTP Error 429" for a page
 *  it did not need. A call that found nothing and whose output says YouTube
 *  was not reached is run again with a fresh proxy address, up to
 *  PROXY_RETRY_ATTEMPTS times, and then throws YoutubeUnreachableError. A call
 *  that found nothing while YouTube did answer returns null: the video has
 *  nothing to give. */
function runYtDlpUntilReached<Found>(url: string, args: string[], found: (stdout: string) => Found | null): Found | null {
  const attempts = ytDlpProxyArgs(url).length > 0 ? PROXY_RETRY_ATTEMPTS : 1;
  let lastReason = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = runYtDlp(url, args);
    const value = found(result.stdout);
    if (value !== null) return value;
    const unreachableLine = result.stderr.split("\n").find((line) => YOUTUBE_UNREACHABLE_RE.test(line));
    if (!unreachableLine) return null;
    lastReason = unreachableLine.trim().slice(0, 200);
    if (attempt < attempts) console.warn(`yt-dlp could not reach YouTube for ${url} (attempt ${attempt}/${attempts}: ${lastReason}), retrying with a fresh proxy IP`);
  }
  throw new YoutubeUnreachableError(url, lastReason);
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
 *
 * The language is a yt-dlp selector, not a plain code, so `en.*` also picks up
 * the regional and uploader-specific spellings of a track. A video usually
 * carries several files that match, and the shortest name is the plain track:
 * `de` before `de-XwLwiJMB_Xs`. YouTube sometimes fails to serve one of them and
 * serves another fine, so every downloaded file is tried in that order.
 */
export function fetchTimedTranscript(url: string, outputDir: string, lang: string = "en"): SubtitleCue[] | null {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  // The first downloaded track that parses into cues. A non-zero exit still
  // leaves behind whatever finished downloading, and one good track is all we
  // need, so the files are read whatever the exit was.
  const downloadedCues = (): SubtitleCue[] | null => {
    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".vtt") || f.endsWith(".ttml") || f.endsWith(".srt"))
      .sort((a, b) => a.length - b.length);
    for (const file of files) {
      const cues = parseSubtitleToCues(fs.readFileSync(path.join(outputDir, file), "utf-8"));
      if (cues.length) return cues;
    }
    return null;
  };
  // Writing subtitles needs no video formats. Without the ignore flag a
  // player response that lists no formats aborts the call before the
  // subtitles are fetched.
  return runYtDlpUntilReached(url, ["--write-subs", "--write-auto-subs", "--sub-lang", lang, "--skip-download", "--ignore-no-formats-error", "-o", outputTemplate, url], downloadedCues);
}

/**
 * The language codes of every caption track a video has, most useful first.
 *
 * YouTube offers each video's own track plus a machine translation of it into
 * every language it knows, and it names them inconsistently: on one video the
 * translations are `en-de-XwLwiJMB_Xs` and on another plain `en`, so a code
 * alone does not say whether a track is original or translated. The listing's
 * Name column does: a translated row reads "Estonian from German", an original
 * row is either blank or names its own language. So we keep the rows without a
 * "from" and drop the rest.
 *
 * The tracks an uploader supplied come first, because they are real subtitles
 * rather than speech recognition.
 */
export function listOriginalSubtitleLanguages(url: string): string[] {
  const listedLanguages = (stdout: string): string[] | null => {
    const languages = parseSubtitleListing(stdout);
    return languages.length ? languages : null;
  };
  return runYtDlpUntilReached(url, ["--list-subs", "--skip-download", "--ignore-no-formats-error", url], listedLanguages) ?? [];
}

/** Reads the language codes out of what `yt-dlp --list-subs` prints. */
export function parseSubtitleListing(listing: string): string[] {
  const uploaded: string[] = [];
  const automatic: string[] = [];
  let section: "uploaded" | "automatic" | null = null;
  for (const line of listing.split("\n")) {
    if (/Available subtitles for/i.test(line)) section = "uploaded";
    else if (/Available automatic captions for/i.test(line)) section = "automatic";
    else if (/^\s*$/.test(line)) section = null;
    if (!section) continue;

    // A row is "<code> <name columns> <formats>". The name is what matters and
    // the columns are only padded with spaces, so the whole rest of the line is
    // searched for the "from" that marks a translation. A format name never
    // contains it.
    const row = /^([A-Za-z0-9_-]+)\s+(\S.*)$/.exec(line);
    if (!row || row[1] === "Language") continue;
    const [, code, rest] = row;
    if (/\bfrom\b/i.test(rest!)) continue;
    (section === "uploaded" ? uploaded : automatic).push(code!);
  }
  return [...uploaded, ...automatic];
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
  // No spoken text can come before the first timing line, so everything above
  // it is a header and is thrown away. Naming the headers one by one is not
  // enough: a file can open with a style block whose CSS would otherwise be
  // read as the video's first words.
  let started = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (line.startsWith("NOTE ")) continue;
    const arrow = line.indexOf("-->");
    if (arrow === -1 && !started) continue;
    if (arrow !== -1) {
      started = true;
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
