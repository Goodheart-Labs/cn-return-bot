import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { fetchTimedTranscript, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import type { FetchedContent } from "../types";

export function ensureYtDlp(): void {
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }
}

/** yt-dlp's upload_date is YYYYMMDD; convert to ISO YYYY-MM-DD (undefined if absent). */
function parseUploadDate(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Fetch id + title + upload date via --print (full -J metadata busts execSync's buffer on YouTube). */
function fetchVideoMeta(url: string): { id: string; title: string; uploadDate?: string } {
  // upload_date first, title last: a multi-line title is absorbed by titleParts
  // without swallowing the other fields.
  const out = execFileSync(
    "yt-dlp",
    ["--skip-download", "--no-warnings", "--print", "%(upload_date)s", "--print", "%(id)s", "--print", "%(title)s", url],
    { encoding: "utf8", timeout: 120_000 },
  );
  const [uploadDate = "", id = "", ...titleParts] = out.trim().split("\n");
  return { id, title: titleParts.join(" ").trim(), uploadDate: parseUploadDate(uploadDate) };
}

export interface ChannelVideo {
  videoId: string;
  url: string;
  title: string;
  durationSeconds: number | null;
}

/** Latest videos of a channel's /videos tab (newest first, Shorts excluded),
 *  via one flat-playlist yt-dlp call. Duration is null for premieres/upcoming. */
export function fetchChannelVideos(channelUrl: string, limit: number): ChannelVideo[] {
  const out = execFileSync(
    "yt-dlp",
    [
      "--flat-playlist",
      "--no-warnings",
      "--playlist-items",
      `1:${limit}`,
      "--print",
      "%(id)s\t%(duration)s\t%(title)s",
      `${channelUrl.replace(/\/$/, "")}/videos`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [videoId = "", duration = "", ...titleParts] = line.split("\t");
      return {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: titleParts.join(" "),
        durationSeconds: /^\d/.test(duration) ? Number.parseFloat(duration) : null,
      };
    });
}

const TRANSCRIPT_LANG = "en";

/** Fetch the video's timestamped cues (temp dir cleaned up); throws if none. */
function fetchCues(url: string): SubtitleCue[] {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const cues = fetchTimedTranscript(url, dir, TRANSCRIPT_LANG);
    if (!cues || cues.length === 0) throw new Error(`No ${TRANSCRIPT_LANG} transcript available for ${url}`);
    return cues;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function fetchYoutubeContent(url: string): FetchedContent {
  const meta = fetchVideoMeta(url);
  return { kind: "youtube", url, videoId: meta.id, title: meta.title, publishedAt: meta.uploadDate, cues: fetchCues(url) };
}

/** Claims come from a caller-supplied transcript; timestamps snap to the video's own cues. */
export function fetchYoutubeTranscriptContent(url: string, transcriptText: string): FetchedContent {
  const meta = fetchVideoMeta(url);
  return {
    kind: "youtube-transcript",
    url,
    videoId: meta.id,
    title: meta.title,
    publishedAt: meta.uploadDate,
    text: transcriptText,
    cues: fetchCues(url),
  };
}
